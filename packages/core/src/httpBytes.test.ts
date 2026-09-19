// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and deliberately not done here: hoisting these literals touches many files and belongs in its own commit where the diff is reviewable, rather than buried in a lint migration. Recorded rather than silently dropped.

import { describe, expect, test as it } from "bun:test";
import { HttpError } from "./errors.ts";
import { type ByteRequest, InMemoryByteFetcher, raiseForByteStatus } from "./httpBytes.ts";

/** A PDF is invented inline: no binary file enters the repo. */
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n%%EOF\n");

function get(url: string): ByteRequest {
  return { url, method: "GET", headers: {} };
}

describe("the in-memory byte fetcher is a real seam", () => {
  it("bytes survive the round trip unchanged", async () => {
    // The whole reason this seam exists: the text fetcher would UTF-8 decode these and the
    // original bytes would be unrecoverable.
    const fetcher = new InMemoryByteFetcher().on("GET", "https://x.test/f", { body: PDF });

    const response = await fetcher.send(get("https://x.test/f"));

    expect(response.bytes).toEqual(PDF);
  });

  it("an unmodelled request rejects rather than returning nothing", async () => {
    // The firing side of the guard, and the property that makes the offline gate mean
    // something: a collector calling an endpoint nobody recorded must fail loudly, not
    // yield an empty result that reads as "the mailbox is empty".
    const fetcher = new InMemoryByteFetcher().on("GET", "https://x.test/known", { body: PDF });

    await expect(fetcher.send(get("https://x.test/unknown"))).rejects.toThrow(
      /no recorded response for GET https:\/\/x.test\/unknown/u,
    );
  });

  it("a recorded request is answered and recorded as a call", async () => {
    // The quiet side. Without it, a fetcher that rejected everything would pass the test
    // above.
    const fetcher = new InMemoryByteFetcher().on("GET", "https://x.test/known", { body: PDF });

    const response = await fetcher.send(get("https://x.test/known"));

    expect(response.status).toBe(200);
    expect(fetcher.calls.map((c) => c.url)).toEqual(["https://x.test/known"]);
  });

  it("queued responses are returned in order, then the last one repeats", async () => {
    // What lets a retry test record `429` then `200` against one URL.
    const fetcher = new InMemoryByteFetcher()
      .on("GET", "https://x.test/p", { status: 429, body: "slow down" })
      .on("GET", "https://x.test/p", { status: 200, body: "ok" });

    const first = await fetcher.send(get("https://x.test/p"));
    const second = await fetcher.send(get("https://x.test/p"));
    const third = await fetcher.send(get("https://x.test/p"));

    expect([first.status, second.status, third.status]).toEqual([429, 200, 200]);
  });

  it("a recorded object body is encoded as JSON", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", "https://x.test/j", {
      body: { messages: [{ id: "m1" }] },
    });

    const response = await fetcher.send(get("https://x.test/j"));

    expect(new TextDecoder().decode(response.bytes)).toBe('{"messages":[{"id":"m1"}]}');
  });
});

describe("raiseForByteStatus", () => {
  it("a 2xx passes through untouched", () => {
    // The quiet side: a guard that always threw would satisfy every test below.
    expect(() =>
      raiseForByteStatus(get("https://x.test/f"), { status: 200, headers: {}, bytes: PDF }),
    ).not.toThrow();
  });

  it("a 429 carries its Retry-After through as milliseconds", () => {
    try {
      raiseForByteStatus(get("https://x.test/f"), {
        status: 429,
        headers: { "retry-after": "30" },
        bytes: new TextEncoder().encode('{"error":"rateLimitExceeded"}'),
      });
      throw new Error("expected raiseForByteStatus to throw");
    } catch (error) {
      if (!(error instanceof HttpError)) {
        throw error;
      }
      expect(error.retryAfterMs).toBe(30_000);
      expect(error.status).toBe(429);
    }
  });

  it("a binary error body does not break the error message", () => {
    // The excerpt is decoded non-fatally. A strict decoder would throw here -- replacing a
    // useful 503 with a TypeError raised while building the log line.
    const notUtf8 = new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0x80]);

    try {
      raiseForByteStatus(get("https://x.test/f"), { status: 503, headers: {}, bytes: notUtf8 });
      throw new Error("expected raiseForByteStatus to throw");
    } catch (error) {
      if (!(error instanceof HttpError)) {
        throw error;
      }
      expect(error.status).toBe(503);
      expect(error.retryAfterMs).toBeNull();
    }
  });

  it("a malformed Retry-After is ignored rather than trusted", () => {
    // "in a bit" must not become NaN milliseconds and park a run.
    try {
      raiseForByteStatus(get("https://x.test/f"), {
        status: 503,
        headers: { "retry-after": "in a bit" },
        bytes: new Uint8Array(),
      });
      throw new Error("expected raiseForByteStatus to throw");
    } catch (error) {
      if (!(error instanceof HttpError)) {
        throw error;
      }
      expect(error.retryAfterMs).toBeNull();
    }
  });
});
