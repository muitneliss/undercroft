/**
 * Which errors are the BM25 door refusing a search (ADR 0156 decision 5), and which are not.
 *
 * The firing side over the real door is `services/rawSearch.test.ts` (`-xe` alone, answered ADR
 * 0123's way). This is the quiet side, which a real database cannot be asked for on demand: an
 * error that is not the refusal must stay an error, or a search that failed for a reason somebody
 * has to fix would be answered the older way and look fine.
 */

import { describe, expect, test as it } from "bun:test";

import { isBm25Refusal } from "./bm25Refusal.ts";

/** What a driver raises for a server error: Postgres's sentence, and its SQLSTATE as `code`. */
function serverError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("isBm25Refusal", () => {
  it("is the door's 55000, read by its code and through a wrapping error", () => {
    const refusal = serverError(
      "undercroft: 4 documents match and the ranked heads hold 0",
      "55000",
    );
    expect(isBm25Refusal(refusal)).toBe(true);
    expect(isBm25Refusal(new Error("the search failed", { cause: refusal }))).toBe(true);
  });

  it("is not a timeout, a permission refusal, an unnamed failure or a non-error", () => {
    expect(
      isBm25Refusal(serverError("canceling statement due to statement timeout", "57014")),
    ).toBe(false);
    expect(isBm25Refusal(serverError("permission denied for function", "42501"))).toBe(false);
    expect(isBm25Refusal(new Error("connection terminated"))).toBe(false);
    expect(isBm25Refusal("55000")).toBe(false);
  });
});
