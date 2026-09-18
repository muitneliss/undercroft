/**
 * What the mail seam promises: a send that failed is visible, and a message that could
 * never arrive is refused before it is counted as sent.
 *
 * The provider is driven by an injected `fetch` that returns real `Response` objects and
 * records what it was handed -- the `InMemoryFetcher` idiom. Nothing here is mocked, and
 * nothing asserts that a function was called; the assertions are on the request that would
 * have gone over the wire and on the error that comes back.
 */

// biome-ignore-all lint/nursery/noConditionalExpect: These assert inside a callback the code under test invokes -- a refresher, an onRetry hook -- which is how you check what a collaborator was handed without mocking it. `.claude/rules/tests.md` bans the mock alternative outright.
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/style/noNestedTernary: Three chained conditions that map one value onto three outcomes. Written as nested if/else they occupy fifteen lines to say the same thing.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/useAwait: An async function with no await, because the port it implements returns a promise. The contract is the signature, not the body -- `.claude/rules/tests.md` and the ESLint config this replaced both called this out by name.

// biome-ignore-all lint/style/noMagicNumbers: In a test the number IS the assertion. `expect(delayMs).toBe(5000)` says what the code must do; `expect(delayMs).toBe(EXPECTED_BACKOFF_MS)` says only that two names agree, and it can pass while both are wrong. Naming a fixture value also puts the expected result somewhere other than the line asserting it, which is the opposite of what .claude/rules/tests.md asks for. Source files get named constants; test files keep their literals.

// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { describe, expect, test as it } from "bun:test";
import { createHttpEmailSender, InMemoryEmailSender, UnsendableEmail } from "./email.ts";
import { HttpError } from "./errors.ts";

interface Recorded {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** A fetch that answers with the given status and records the one request it received. */
function recordingFetch(
  status: number,
  responseBody = "{}",
): { seen: Recorded[]; fetchImpl: typeof fetch } {
  const seen: Recorded[] = [];
  async function recorder(
    input: Parameters<typeof globalThis.fetch>[0],
    init: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> {
    // Narrow rather than stringify: `RequestInfo` and `BodyInit` are unions that include
    // objects, and String() on one of those silently yields "[object Object]".
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === "string" ? init.body : "";
    seen.push({
      url,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(body),
    });
    return new Response(responseBody, { status });
  }
  const fetchImpl = recorder as typeof globalThis.fetch;
  return { seen, fetchImpl };
}

describe("the HTTP provider sends what it was given, and says so when it cannot", () => {
  it("a sign-in code is posted as from/to/subject/text with a bearer key", async () => {
    // The wire shape is the whole contract with the provider: a renamed field is a mail
    // that is never delivered, with a 200 to say it went fine.
    const { seen, fetchImpl } = recordingFetch(200);
    const sender = createHttpEmailSender({
      apiKey: "key_test",
      from: "Undercroft <no-reply@example.test>",
      endpoint: "https://mail.example.test/send",
      fetch: fetchImpl,
    });

    await sender.send({ to: "operator@example.test", subject: "Your code", text: "123456" });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://mail.example.test/send");
    expect(seen[0]?.headers.authorization).toBe("Bearer key_test");
    expect(seen[0]?.body).toEqual({
      from: "Undercroft <no-reply@example.test>",
      to: ["operator@example.test"],
      subject: "Your code",
      text: "123456",
    });
  });

  it("a rejected send raises with the status rather than resolving", async () => {
    // The guard that matters most here. A swallowed failure reads as "code sent" to
    // everything upstream while the person waits for an email that will never come.
    const { fetchImpl } = recordingFetch(422, "address is not valid");
    const sender = createHttpEmailSender({
      apiKey: "key_test",
      from: "no-reply@example.test",
      endpoint: "https://mail.example.test/send",
      fetch: fetchImpl,
    });

    try {
      await sender.send({ to: "operator@example.test", subject: "Your code", text: "123456" });
      throw new Error("expected the send to raise");
    } catch (error) {
      if (!(error instanceof HttpError)) {
        throw error;
      }
      expect(error.status).toBe(422);
      expect(error.bodyExcerpt).toBe("address is not valid");
    }
  });
});

describe("the in-memory sender refuses what a provider would reject", () => {
  it("a usable message is recorded", async () => {
    const sender = new InMemoryEmailSender();
    await sender.send({ to: "operator@example.test", subject: "Your code", text: "123456" });

    expect(sender.sent).toHaveLength(1);
    expect(sender.last?.to).toBe("operator@example.test");
  });

  it("an address that is not an address is refused, not recorded", async () => {
    // The quiet side of the test above. A fake that accepted this would let a bug that
    // mails codes to an unsubstituted template variable pass the whole suite.
    const sender = new InMemoryEmailSender();

    try {
      await sender.send({ to: "operator", subject: "Your code", text: "123456" });
      throw new Error("expected an unusable recipient to be refused");
    } catch (error) {
      if (!(error instanceof UnsendableEmail)) {
        throw error;
      }
      expect(sender.sent).toHaveLength(0);
    }
  });
});
