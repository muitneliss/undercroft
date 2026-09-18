// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.
// biome-ignore-all lint/nursery/noConditionalExpect: These assert inside a callback the code under test invokes -- a refresher, an onRetry hook -- which is how you check what a collaborator was handed without mocking it. `.claude/rules/tests.md` bans the mock alternative outright.
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/performance/noAwaitInLoops: These sequential awaits are the point. Pacing a connector against a rate limit, walking Dokploy deployment records until one settles, and migrating SQL files in order all require the previous iteration to finish first; running them concurrently is the bug this rule would introduce.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and deliberately not done here: hoisting these literals touches many files and belongs in its own commit where the diff is reviewable, rather than buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/security/noSecrets: False positives. The rule flags high-entropy string literals, and these are test fixtures with invented values (per .claude/rules/pii.md, fixtures are invented rather than anonymised), plus base64url sample tokens and SQL role names. No real credential is in any tracked file; CI enforces that separately.
// biome-ignore-all lint/style/noIncrementDecrement: `i += 1` is already the form used throughout; what remains is inside for-loop headers, where `i++` is the idiom the language reads best.
// biome-ignore-all lint/style/noMagicNumbers: In a test the number IS the assertion. `expect(delayMs).toBe(5000)` says what the code must do; `expect(delayMs).toBe(EXPECTED_BACKOFF_MS)` says only that two names agree, and it can pass while both are wrong. Naming a fixture value also puts the expected result somewhere other than the line asserting it, which is the opposite of what .claude/rules/tests.md asks for. Source files get named constants; test files keep their literals.

import { ConnectorError, createPacer, InMemoryByteFetcher, TestClock } from "@undercroft/core";
import { describe, expect, test as it } from "bun:test";

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
    for (let i = 0; i < 3; i++) {
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

  it("an unrecorded endpoint fails loudly rather than reading as an empty mailbox", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", URL_A, { body: { labels: [] } });

    await expect(
      apiWith(fetcher, new TestClock()).getJson("https://gmail.googleapis.test/other", "messages"),
    ).rejects.toThrow(/no recorded response/u);
  });
});
