// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.

import { describe, expect, test as it } from "bun:test";
import { documentKeyOf, documentPrefixOf, RawDocument } from "./rawDocument.ts";

const IDENTITY = { source: "gmail", tenantId: "CASE-0042", documentId: "19a2f:001" } as const;

describe("document keys", () => {
  it("a key is prefix plus id, and nothing else", () => {
    expect(documentKeyOf(IDENTITY)).toBe("documents/gmail/CASE-0042/19a2f:001");
  });

  it("the prefix is what a tenant's documents share", () => {
    expect(documentPrefixOf(IDENTITY)).toBe("documents/gmail/CASE-0042");
    expect(documentKeyOf(IDENTITY).startsWith(documentPrefixOf(IDENTITY))).toBe(true);
  });

  it("documents do not share the records prefix", () => {
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

  it("a well-formed document parses", () => {
    expect(RawDocument.safeParse(valid()).success).toBe(true);
  });

  it("a document with no id is refused rather than landed under a guess", () => {
    const result = RawDocument.safeParse(valid({ documentId: "" }));

    expect(result.success).toBe(false);
  });

  it("a byte length that is not digits is refused", () => {
    // It becomes `$n::bigint[]`. A float in that position is a silently wrong file size.
    expect(RawDocument.safeParse(valid({ byteLength: "2048.5" })).success).toBe(false);
  });

  it("an absent sourceUpdatedAt is honest and allowed", () => {
    expect(RawDocument.safeParse(valid({ sourceUpdatedAt: null })).success).toBe(true);
  });
});
