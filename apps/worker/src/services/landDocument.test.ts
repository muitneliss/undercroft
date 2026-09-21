import { createStampSource, TestClock } from "@undercroft/core";
import { InMemoryObjectStore, type JournalEntry, LakeStore } from "@undercroft/lake";
import { beforeEach, describe, expect, test as it } from "bun:test";

import { type DocumentToLand, landDocuments, MAX_DOCUMENT_BYTES } from "./landDocument.ts";

let backing: InMemoryObjectStore;
let lake: LakeStore;

/** Invented inline: no binary file enters the repo. */
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n%%EOF\n");

beforeEach(() => {
  backing = new InMemoryObjectStore();
  lake = new LakeStore(backing, { stamps: createStampSource(new TestClock()) });
});

function document(over: Partial<DocumentToLand> = {}): DocumentToLand {
  return {
    documentId: "19a2f:001",
    contentType: "application/pdf",
    declaredBytes: String(PDF.byteLength),
    metadata: { partIndex: 1, labelIds: ["Label_8"] },
    manifest: { filename: "invoice-0042.pdf", subject: "Invoice 0042", mailbox: "ops@acme.test" },
    sourceUpdatedAt: "2026-09-17T12:00:00.000Z",
    fetchBytes: () => Promise.resolve(PDF),
    ...over,
  };
}

function land(documents: readonly DocumentToLand[]) {
  return landDocuments(lake, {
    source: "gmail",
    tenantId: "CASE-0042",
    runId: "run-1",
    documents,
  });
}

describe("landDocuments", () => {
  it("a document is landed under its own key and reported created", async () => {
    const result = await land([document()]);

    expect(result.created).toBe(1);
    expect(result.results[0]?.lakeKey).toBe("documents/gmail/CASE-0042/19a2f:001");
    expect(result.results[0]?.byteLength).toBe(String(PDF.byteLength));
  });

  it("re-landing identical bytes reports unchanged and writes no new version", async () => {
    // The lake's content addressing, reached through this path. Without it an hourly
    // schedule pushes real history out through retention using copies of the same file.
    await land([document()]);

    const result = await land([document()]);

    expect(result).toMatchObject({ created: 0, unchanged: 1, failed: 0, skipped: 0 });
    expect(await lake.versions("documents/gmail/CASE-0042/19a2f:001")).toHaveLength(1);
  });

  it("an oversized document is refused before its bytes are fetched", async () => {
    // The firing side of the size guard, and `fetchBytes` rejecting is how the test proves
    // "before": the lake has no streaming path, so a 300 MB attachment does not run slowly,
    // it ends the process.
    const result = await land([
      document({
        declaredBytes: String(MAX_DOCUMENT_BYTES + 1),
        fetchBytes: () => Promise.reject(new Error("must not be fetched")),
      }),
    ]);

    expect(result.skipped).toBe(1);
    expect(result.results[0]?.status).toBe("skipped");
    expect(result.results[0]?.reason).toMatch(/over the \d+ ceiling/u);
  });

  it("a document exactly at the ceiling is landed, not refused", async () => {
    // The quiet side. A guard written with `>=` would reject the boundary case, and the
    // test above would not notice.
    const result = await land([document({ declaredBytes: String(MAX_DOCUMENT_BYTES) })]);

    expect(result).toMatchObject({ created: 1, skipped: 0 });
  });

  it("a declared size too large for a float is still compared exactly", async () => {
    // BigInt, not Number: a provider-controlled size string must not round into range.
    const result = await land([
      document({
        declaredBytes: "99999999999999999999",
        fetchBytes: () => Promise.reject(new Error("must not be fetched")),
      }),
    ]);

    expect(result.skipped).toBe(1);
  });

  it("one failing document does not abort the batch", async () => {
    const result = await land([
      document({ documentId: "bad", fetchBytes: () => Promise.reject(new Error("410 gone")) }),
      document({ documentId: "good" }),
    ]);

    expect(result).toMatchObject({ created: 1, failed: 1 });
    expect(result.results.find((r) => r.documentId === "bad")?.reason).toBe("410 gone");
  });

  it("names a human wrote reach the lake manifest", async () => {
    await land([document()]);

    const [stamp] = await lake.versions("documents/gmail/CASE-0042/19a2f:001");
    const manifest = await lake.manifest("documents/gmail/CASE-0042/19a2f:001", stamp ?? "");

    expect(manifest.filename).toBe("invoice-0042.pdf");
    expect(manifest.mailbox).toBe("ops@acme.test");
  });

  it("a filename never reaches the lake key", async () => {
    // The other half of the PII boundary. `raw.documents.lake_key` is granted to dbt, so a
    // filename in a key is one `dbt run` from a dashboard.
    const result = await land([document()]);

    expect(result.results[0]?.lakeKey).not.toContain("invoice-0042");
  });

  it("a document is landed with no journal stream", async () => {
    // Journalled objects are decoded as JSON text for `payload jsonb` by the record loader.
    // A PDF on that path is mojibake in a jsonb column, so documents stay off the journal
    // and are catalogued directly instead.
    await land([document()]);

    const journalled: JournalEntry[] = [];
    for await (const entry of lake.journalSince("documents/gmail/CASE-0042", null)) {
      journalled.push(entry);
    }
    expect(journalled).toEqual([]);
  });
});
