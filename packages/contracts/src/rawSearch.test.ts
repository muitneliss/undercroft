/**
 * The search contract, pinned where a caller could otherwise be surprised: the defaults a
 * request falls back to, and the union that keeps a record hit and a document hit apart.
 */

import { describe, expect, test as it } from "bun:test";

import {
  DEFAULT_SEARCH_HITS,
  MAX_SEARCH_QUERY_CHARS,
  RawSearchHit,
  RawSearchRequest,
} from "./rawSearch.ts";

describe("RawSearchRequest", () => {
  it("searches both halves of the lake when the caller does not narrow it", async () => {
    const parsed = RawSearchRequest.parse({ tenantId: "CASE-0042", q: "hop dong" });
    expect(parsed.kinds).toEqual(["record", "document"]);
    expect(parsed.limit).toBe(DEFAULT_SEARCH_HITS);
    expect(parsed.offset).toBe(0);
  });

  it("trims the question, so a pasted string with a newline is the same question", () => {
    expect(RawSearchRequest.parse({ tenantId: "CASE-0042", q: "  hop dong\n" }).q).toBe("hop dong");
  });

  it("refuses a blank question rather than searching for nothing", () => {
    // The firing side. A blank tsquery matches no row, so this would answer "nothing found"
    // to a question nobody asked -- which reads like an empty lake.
    expect(RawSearchRequest.safeParse({ tenantId: "CASE-0042", q: "   " }).success).toBe(false);
  });

  it("refuses an empty kinds list", () => {
    expect(RawSearchRequest.safeParse({ tenantId: "CASE-0042", q: "x", kinds: [] }).success).toBe(
      false,
    );
  });

  it("refuses a question past the ceiling", () => {
    const tooLong = "a".repeat(MAX_SEARCH_QUERY_CHARS + 1);
    expect(RawSearchRequest.safeParse({ tenantId: "CASE-0042", q: tooLong }).success).toBe(false);
  });
});

describe("RawSearchHit", () => {
  const base = {
    source: "hubspot",
    rank: 0.1,
    excerpt: "Hợp đồng thuê nhà",
    observedAt: "2026-03-01T00:00:00.000Z",
    deletedAt: null,
  };

  it("accepts a record hit with its stream coordinates", () => {
    const hit = RawSearchHit.parse({
      kind: "record",
      ...base,
      entity: "deals",
      sourceRecordId: "42",
    });
    expect(hit.kind === "record" ? hit.sourceRecordId : null).toBe("42");
  });

  it("accepts a document hit with how it was read", () => {
    const hit = RawSearchHit.parse({
      kind: "document",
      ...base,
      documentId: "d1",
      method: "pdf_ocr",
      truncated: false,
    });
    expect(hit.kind === "document" ? hit.method : null).toBe("pdf_ocr");
  });

  it("refuses a record hit wearing a document's fields", () => {
    // The quiet side of the union: the two shapes may not be interchanged, which is the whole
    // reason they are not one object with everything nullable.
    expect(
      RawSearchHit.safeParse({ kind: "record", ...base, documentId: "d1", method: null }).success,
    ).toBe(false);
  });
});
