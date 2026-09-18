import { ConnectorError, createPacer, InMemoryByteFetcher, TestClock } from "@undercroft/core";
import { describe, expect, test } from "bun:test";

import { createGoogleApi, GOOGLE_MIN_INTERVAL_MS } from "./api.ts";

const URL_A = "https://gmail.googleapis.test/gmail/v1/users/me/labels";

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
  test("a JSON body is parsed and the bearer token is attached", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, {
      body: { labels: [{ id: "Label_8", name: "Invoices" }] },
    });

    const body = await apiWith(fetcher, new TestClock()).getJson(URL_A, "labels");

    expect(body).toEqual({ labels: [{ id: "Label_8", name: "Invoices" }] });
    expect(fetcher.calls[0]?.headers["authorization"]).toBe("Bearer tok");
  });

  test("a large id keeps every digit rather than rounding through a float", async () => {
    // parseLossless, the same guarantee the connector runtime gives. A Drive file's
    // `version` or a Gmail `historyId` beyond 2^53 must not come back changed.
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, {
      body: '{"historyId":12345678901234567890}',
    });

    const body = (await apiWith(fetcher, new TestClock()).getJson(URL_A, "messages")) as {
      historyId: { toString(): string };
    };

    expect(body.historyId.toString()).toBe("12345678901234567890");
  });

  test("bytes come back untouched", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, { body: pdf });

    expect(await apiWith(fetcher, new TestClock()).getBytes(URL_A, "files")).toEqual(pdf);
  });

  test("a 429 is retried and the run continues", async () => {
    // Driven the way `retry.test.ts` drives one: start the call, then advance the clock.
    // Nothing sleeps for real, which is the whole point of pacing on an injected clock.
    const clock = new TestClock();
    const fetcher = new InMemoryByteFetcher()
      .on("GET", URL_A, { status: 429, headers: { "retry-after": "1" }, body: "slow down" })
      .on("GET", URL_A, { body: { labels: [] } });

    const pending = apiWith(fetcher, clock).getJson(URL_A, "labels");
    for (let i = 0; i < 3; i++) {
      await clock.advance(60_000);
    }

    expect(await pending).toEqual({ labels: [] });
    expect(fetcher.calls).toHaveLength(2);
  });

  test("a 401 is not retried, because a credential failure is not transient", async () => {
    // Retrying it turns a clear "the customer disconnected us" into a slow one, and on some
    // providers into a lockout.
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, {
      status: 401,
      body: { error: "invalid_credentials" },
    });

    await expect(apiWith(fetcher, new TestClock()).getJson(URL_A, "labels")).rejects.toThrow();
    expect(fetcher.calls).toHaveLength(1);
  });

  test("a failure raises a ConnectorError carrying how much had been seen", async () => {
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

  test("an unrecorded endpoint fails loudly rather than reading as an empty mailbox", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, { body: { labels: [] } });

    await expect(
      apiWith(fetcher, new TestClock()).getJson("https://gmail.googleapis.test/other", "messages"),
    ).rejects.toThrow(/no recorded response/);
  });
});
