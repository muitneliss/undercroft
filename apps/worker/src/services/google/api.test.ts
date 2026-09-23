import { ConnectorError, createPacer, InMemoryByteFetcher, TestClock } from "@undercroft/core";
import { describe, expect, test as it } from "bun:test";

import {
  createGoogleApi,
  GOOGLE_INTERVAL_ENV,
  GOOGLE_MIN_INTERVAL_MS,
  googleMinIntervalMs,
} from "./api.ts";

const URL_A = "https://gmail.googleapis.test/gmail/v1/users/me/labels";

/**
 * The quota refusal Gmail actually sends, reproduced in shape.
 *
 * `consumer` is parameterised because the whole hazard is where the 500-byte body excerpt
 * falls. The message is repeated twice before `errors[0].reason`, so two extra characters in
 * the consumer name move that token two bytes: with our own project number it ends at byte
 * 499 and is matched, with one digit more it ends at 501 and is gone. A test that used only
 * the first would pass for a detector reading the reason alone -- the detector that let a
 * 7,777-message backfill die at 378.
 */
function quotaRefusal(consumer: string): string {
  const message =
    "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per " +
    `user' of service 'gmail.googleapis.com' for consumer '${consumer}'.`;
  return JSON.stringify(
    {
      error: {
        code: 403,
        message,
        errors: [{ message, domain: "usageLimits", reason: "rateLimitExceeded" }],
        status: "RESOURCE_EXHAUSTED",
      },
    },
    null,
    2,
  );
}

/** A consumer name one digit longer than ours, which pushes `reason` past the excerpt. */
const REASON_TRUNCATED = quotaRefusal("project_number:1823022475567");

function apiWith(fetcher: InMemoryByteFetcher, clock: TestClock, token = "tok") {
  return createGoogleApi("gmail", {
    fetcher,
    token: () => Promise.resolve(token),
    clock,
    pacer: createPacer({ minIntervalMs: GOOGLE_MIN_INTERVAL_MS }, clock),
    // Fixed, so a backoff assertion is exact rather than a range. A range passes for an
    // implementation that is subtly wrong.
    random: () => 0.5,
  });
}

describe("createGoogleApi", () => {
  it("a JSON body is parsed and the bearer token is attached", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, {
      body: { labels: [{ id: "Label_8", name: "Invoices" }] },
    });

    const body = await apiWith(fetcher, new TestClock()).getJson(URL_A, "labels");

    expect(body).toEqual({ labels: [{ id: "Label_8", name: "Invoices" }] });
    expect(fetcher.calls[0]?.headers.authorization).toBe("Bearer tok");
  });

  it("a large id keeps every digit rather than rounding through a float", async () => {
    // parseLossless, the same guarantee the connector runtime gives. A Drive file's
    // `version` or a Gmail `historyId` beyond 2^53 must not come back changed.
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, {
      body: '{"historyId":12345678901234567890}',
    });

    const body = (await apiWith(fetcher, new TestClock()).getJson(URL_A, "messages")) as {
      historyId: { toString: () => string };
    };

    expect(body.historyId.toString()).toBe("12345678901234567890");
  });

  it("bytes come back untouched", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, { body: pdf });

    expect(await apiWith(fetcher, new TestClock()).getBytes(URL_A, "files")).toEqual(pdf);
  });

  it("a 429 is retried and the run continues", async () => {
    // Driven the way `retry.test.ts` drives one: start the call, then advance the clock.
    // Nothing sleeps for real, which is the whole point of pacing on an injected clock.
    const clock = new TestClock();
    const fetcher = new InMemoryByteFetcher()
      .on("GET", URL_A, { status: 429, headers: { "retry-after": "1" }, body: "slow down" })
      .on("GET", URL_A, { body: { labels: [] } });

    const pending = apiWith(fetcher, clock).getJson(URL_A, "labels");
    for (let i = 0; i < 3; i += 1) {
      await clock.advance(60_000);
    }

    expect(await pending).toEqual({ labels: [] });
    expect(fetcher.calls).toHaveLength(2);
  });

  it("a 401 is not retried, because a credential failure is not transient", async () => {
    // Retrying it turns a clear "the customer disconnected us" into a slow one, and on some
    // providers into a lockout.
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, {
      status: 401,
      body: { error: "invalid_credentials" },
    });

    await expect(apiWith(fetcher, new TestClock()).getJson(URL_A, "labels")).rejects.toThrow();
    expect(fetcher.calls).toHaveLength(1);
  });

  it("a failure raises a ConnectorError carrying how much had been seen", async () => {
    // Never an empty result on failure. "Failed after 412" is a transient upstream fault,
    // "failed after 0" is a credential problem, and the count is what tells them apart.
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, { status: 403, body: "denied" });

    try {
      await apiWith(fetcher, new TestClock()).getJson(URL_A, "messages", 412);
      throw new Error("expected getJson to raise");
    } catch (error) {
      if (!(error instanceof ConnectorError)) {
        throw error;
      }
      expect(error.seen).toBe(412);
      expect(error.message).toContain("gmail/messages failed after 412");
    }
  });

  it("a 403 that IS Gmail's rate limit is retried, because it is transient", async () => {
    // Gmail does not answer a rate limit with 429. It answers `403 rateLimitExceeded`, and
    // Google's own error guide says to back off and retry it. Treating every 403 as fatal
    // ends a real backfill mid-mailbox -- observed here as "failed after 196 records".
    const clock = new TestClock();
    const fetcher = new InMemoryByteFetcher()
      .on("GET", URL_A, {
        status: 403,
        body: { error: { code: 403, errors: [{ reason: "userRateLimitExceeded" }] } },
      })
      .on("GET", URL_A, { body: { labels: [] } });

    const pending = apiWith(fetcher, clock).getJson(URL_A, "labels");
    for (let i = 0; i < 3; i += 1) {
      await clock.advance(60_000);
    }

    expect(await pending).toEqual({ labels: [] });
    expect(fetcher.calls).toHaveLength(2);
  });

  it("a 403 that is a PERMISSION refusal is not retried", async () => {
    // The quiet side, and why this is not `on: [403]`. A scope the customer did not grant
    // is not transient: retrying it five times with backoff turns a clear refusal into a
    // slow one and tells the operator nothing new.
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, {
      status: 403,
      body: { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } },
    });

    await expect(apiWith(fetcher, new TestClock()).getJson(URL_A, "labels")).rejects.toThrow();
    expect(fetcher.calls).toHaveLength(1);
  });

  it("a failure says what the provider said, not just the status", async () => {
    // The body excerpt was captured by `raiseForByteStatus` and then dropped on the floor:
    // `HttpError`'s message is status-and-url only. So "HTTP 403" reached the operator with
    // the one word that distinguishes a rate limit from a revoked scope sitting unused in
    // memory. Rule 2 -- say why.
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, {
      status: 403,
      body: { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } },
    });

    await expect(apiWith(fetcher, new TestClock()).getJson(URL_A, "messages", 196)).rejects.toThrow(
      /insufficientPermissions/u,
    );
  });

  it("the quota refusal is retried even when its reason falls past the body excerpt", async () => {
    // The regression that killed a 7,777-message sync at 378 records. `raiseForByteStatus`
    // keeps 500 bytes; in this body `"reason": "rateLimitExceeded"` ends at byte 501, so a
    // detector that reads the reason alone sees a bare 403, calls it a permission refusal
    // and gives up on the first attempt. The message text says `Quota exceeded` at byte 30.
    const clock = new TestClock();
    const fetcher = new InMemoryByteFetcher()
      .on("GET", URL_A, { status: 403, body: REASON_TRUNCATED })
      .on("GET", URL_A, { body: { labels: [] } });

    const pending = apiWith(fetcher, clock).getJson(URL_A, "labels");
    for (let i = 0; i < 3; i += 1) {
      await clock.advance(60_000);
    }

    expect(await pending).toEqual({ labels: [] });
    expect(fetcher.calls).toHaveLength(2);
  });

  it("a rate limit lasting a full minute is waited out rather than ending the run", async () => {
    // The second half of the same failure, and the one a body-text match alone does not fix.
    // The quota names its window -- `limit 'Units per minute per user'` -- so the budget has
    // to span a minute. `DEFAULT_RETRY` spends four sleeps totalling at most 7.5 seconds,
    // which burns every attempt inside the very window that refused the first one.
    const clock = new TestClock();
    const fetcher = new InMemoryByteFetcher();
    for (let i = 0; i < 6; i += 1) {
      fetcher.on("GET", URL_A, { status: 403, body: REASON_TRUNCATED });
    }
    fetcher.on("GET", URL_A, { body: { labels: [] } });

    let outcome = "pending";
    const call = apiWith(fetcher, clock)
      .getJson(URL_A, "labels")
      .then(
        () => {
          outcome = "landed";
        },
        () => {
          outcome = "gave up";
        },
      );

    // A minute of unbroken refusals. The old policy had given up by second eight.
    for (let second = 0; second < 60; second += 1) {
      await clock.advance(1000);
    }
    expect(outcome).toBe("pending");

    // And it still lands once the window refills, rather than merely failing later.
    for (let second = 0; second < 130; second += 1) {
      await clock.advance(1000);
    }
    await call;
    expect(outcome).toBe("landed");
  });

  it("a daily cap is not retried, because no run can wait out a quota that resets at midnight", async () => {
    // The quiet side of widening the match to the message text: Google words a daily
    // exhaustion in the same "Quota exceeded for quota metric" sentence as a per-minute one.
    // Sleeping three minutes on it is `pacer.ts`'s `QuotaExhausted` mistake -- a worker
    // parked, appearing to make progress -- and it ends in the same refusal regardless.
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, {
      status: 403,
      body: {
        error: {
          code: 403,
          message:
            "Quota exceeded for quota metric 'Queries' and limit 'Queries per day' of " +
            "service 'gmail.googleapis.com'.",
          errors: [{ reason: "dailyLimitExceeded" }],
        },
      },
    });

    await expect(apiWith(fetcher, new TestClock()).getJson(URL_A, "labels")).rejects.toThrow();
    expect(fetcher.calls).toHaveLength(1);
  });

  it("an unrecorded endpoint fails loudly rather than reading as an empty mailbox", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, { body: { labels: [] } });

    await expect(
      apiWith(fetcher, new TestClock()).getJson("https://gmail.googleapis.test/other", "messages"),
    ).rejects.toThrow(/no recorded response/u);
  });
});

describe("googleMinIntervalMs", () => {
  it("paces for the 2-4 messages.get/second/user Gmail enforces, not the documented rate", () => {
    // 120ms -- 8.3 a second -- was read off Google's published 15,000 units/minute/user.
    // The enforced rate is a fraction of it, and riding the published one killed a backfill
    // 45 seconds in. Three a second is the middle of the measured range.
    expect(GOOGLE_MIN_INTERVAL_MS).toBe(334);
    expect(googleMinIntervalMs({})).toBe(GOOGLE_MIN_INTERVAL_MS);
  });

  it("a deployment can dial the interval to its own project's enforced quota", () => {
    // The enforced number belongs to the Cloud project, not to Google, so the next
    // deployment's may differ and must not need a release to change.
    expect(googleMinIntervalMs({ [GOOGLE_INTERVAL_ENV]: "500" })).toBe(500);
  });

  it("an unreadable interval is refused rather than silently pacing at the default", () => {
    // The quiet side. The default is what caused the outage this setting exists to prevent,
    // so falling back to it on a typo hides the one knob an operator reached for -- and the
    // symptom is another dead backfill with the variable sitting in the compose file looking
    // applied. Rule 2: never guess, say why.
    expect(() => googleMinIntervalMs({ [GOOGLE_INTERVAL_ENV]: "334ms" })).toThrow(
      /must be a positive whole number of milliseconds/u,
    );
    expect(() => googleMinIntervalMs({ [GOOGLE_INTERVAL_ENV]: "0" })).toThrow(
      /must be a positive whole number of milliseconds/u,
    );
  });
});
