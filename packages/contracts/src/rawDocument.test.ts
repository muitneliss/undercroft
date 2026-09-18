import { describe, expect, test } from "bun:test";
import { documentKeyOf, documentPrefixOf, RawDocument } from "./rawDocument.ts";

const IDENTITY = { source: "gmail", tenantId: "CASE-0042", documentId: "19a2f:001" } as const;

describe("document keys", () => {
  test("a key is prefix plus id, and nothing else", () => {
    expect(documentKeyOf(IDENTITY)).toBe("documents/gmail/CASE-0042/19a2f:001");
  });

  test("the prefix is what a tenant's documents share", () => {
    expect(documentPrefixOf(IDENTITY)).toBe("documents/gmail/CASE-0042");
    expect(documentKeyOf(IDENTITY).startsWith(documentPrefixOf(IDENTITY))).toBe(true);
  });

  test("documents do not share the records prefix", () => {
    // They are loaded by a different mechanism: the record loader decodes every journalled
    // object as JSON text, which a PDF is not.
    expect(documentKeyOf(IDENTITY).startsWith("records/")).toBe(false);
  });
});

describe("RawDocument", () => {
  function valid(over: Record<string, unknown> = {}) {
    return {
      source: "gmail",
      tenantId: "CASE-0042",
      documentId: "19a2f:001",
      contentType: "application/pdf",
      byteLength: "2048",
      sourceUpdatedAt: "2026-09-17T12:00:00.000Z",
      ...over,
    };
  }

  test("a well-formed document parses", () => {
    expect(RawDocument.safeParse(valid()).success).toBe(true);
  });

  test("a document with no id is refused rather than landed under a guess", () => {
    const result = RawDocument.safeParse(valid({ documentId: "" }));

    expect(result.success).toBe(false);
  });

  test("a byte length that is not digits is refused", () => {
    // It becomes `$n::bigint[]`. A float in that position is a silently wrong file size.
    expect(RawDocument.safeParse(valid({ byteLength: "2048.5" })).success).toBe(false);
  });

  test("an absent sourceUpdatedAt is honest and allowed", () => {
    expect(RawDocument.safeParse(valid({ sourceUpdatedAt: null })).success).toBe(true);
  });
});
