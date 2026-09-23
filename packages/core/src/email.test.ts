/**
 * What the mail seam promises: a send that failed is visible, and a message that could
 * never arrive is refused before it is counted as sent.
 *
 * The provider is driven by an injected `fetch` that returns real `Response` objects and
 * records what it was handed -- the `InMemoryFetcher` idiom. Nothing here is mocked, and
 * nothing asserts that a function was called; the assertions are on the request that would
 * have gone over the wire and on the error that comes back.
 */

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

  it("a message that was set carries its html alongside the text, never instead of it", async () => {
    const { seen, fetchImpl } = recordingFetch(200);
    const sender = createHttpEmailSender({
      apiKey: "key_test",
      from: "Undercroft <no-reply@example.test>",
      endpoint: "https://mail.example.test/send",
      fetch: fetchImpl,
    });

    await sender.send({
      to: "operator@example.test",
      subject: "Your code",
      text: "123456",
      html: "<p>123456</p>",
    });

    expect(seen[0]?.body).toEqual({
      from: "Undercroft <no-reply@example.test>",
      to: ["operator@example.test"],
      subject: "Your code",
      text: "123456",
      html: "<p>123456</p>",
    });
  });

  it("a message with nothing set omits the field rather than sending an empty part", async () => {
    // The quiet side of the test above. A provider handed an explicit empty HTML part
    // renders an empty message in every client that prefers markup -- which is every
    // client -- while reporting a clean 200.
    const { seen, fetchImpl } = recordingFetch(200);
    const sender = createHttpEmailSender({
      apiKey: "key_test",
      from: "no-reply@example.test",
      endpoint: "https://mail.example.test/send",
      fetch: fetchImpl,
    });

    await sender.send({ to: "operator@example.test", subject: "Your code", text: "123456" });

    expect(seen[0]?.body).not.toHaveProperty("html");
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

  it("markup is not a substitute for the message: an empty text is still refused", async () => {
    // `html` is optional and `text` is not, and this is what holds that apart. Without it
    // somebody sets a beautiful leaf, leaves the text branch empty, and every reader whose
    // client prefers plain text -- and every forwarded quote -- gets a blank email.
    const sender = new InMemoryEmailSender();

    try {
      await sender.send({
        to: "operator@example.test",
        subject: "Your code",
        text: "",
        html: "<p>123456</p>",
      });
      throw new Error("expected a message with no text to be refused");
    } catch (error) {
      if (!(error instanceof UnsendableEmail)) {
        throw error;
      }
      expect(sender.sent).toHaveLength(0);
    }
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
