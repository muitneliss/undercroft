/**
 * The extract backlog: which documents a pass is offered, and -- the point of this suite --
 * which it is never offered however much the readers change.
 *
 * Real PGlite, seeded as the superuser and then run as `undercroft_worker`, because a grant
 * that does not cover the new `reader_version` column must fail here and not at 02:00.
 *
 * Every test asks BOTH halves of the one predicate. `pendingDocuments` and `pendingScopes`
 * share `PENDING_JOIN` so that "pending" has one definition; a suite that only asked the first
 * would let the second drift into a scheduler that ticks forever over a tenant whose documents
 * the run then declines to read.
 */

import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import {
  type DocumentTextRow,
  pendingDocuments,
  pendingScopes,
  upsertDocumentText,
} from "./documentText.ts";

const TENANT = "CASE-0042";
const SOURCE = "drive";
const SCOPE = { tenantId: TENANT, source: SOURCE } as const;
const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);

/**
 * Two generations of readers, named here rather than imported from the service.
 *
 * The repo's rule is "older than what you asked with", not "older than 1". Pinning the suite to
 * `CURRENT_READER_VERSION` would make every bump of that constant a red suite about nothing,
 * and would test the service's number instead of this module's comparison.
 */
const BEFORE = 0;
const NOW = 1;

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  // From here every statement runs as the worker does in production.
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

/** Catalogue a document the way an ingest run leaves it. The bytes themselves are not needed. */
async function land(documentId: string, sha256 = SHA): Promise<void> {
  await db.query(
    `INSERT INTO raw.documents
       (source, tenant_id, document_id, lake_key, sha256, byte_length, content_type,
        observed_at, run_id)
     VALUES ($1, $2, $3, $4, $5, '2048', 'application/pdf', now(), 'run-seed')`,
    [SOURCE, TENANT, documentId, `documents/${SOURCE}/${TENANT}/${documentId}`, sha256],
  );
}

function row(documentId: string, over: Partial<DocumentTextRow> = {}): DocumentTextRow {
  return {
    documentId,
    sourceSha256: SHA,
    method: null,
    reason: "unsupported-content-type",
    text: "",
    truncated: false,
    ...over,
  };
}

/** Record an extraction pass that ran at `readerVersion`. */
async function extractedAt(
  readerVersion: number,
  rows: readonly DocumentTextRow[],
): Promise<number> {
  return upsertDocumentText(db, SCOPE, rows, {
    extractedAt: "2026-09-20T09:00:00.000Z",
    runId: `run-extract-${readerVersion}`,
    readerVersion,
  });
}

/** What a pass running `readerVersion` would be given -- both halves of the one predicate. */
async function backlog(
  readerVersion: number,
): Promise<{ documentIds: string[]; scopes: string[] }> {
  const documents = await pendingDocuments(db, SCOPE, { limit: 50, readerVersion });
  const scopes = await pendingScopes(db, { readerVersion });
  return {
    documentIds: documents.map((d) => d.documentId),
    scopes: scopes.map((s) => `${s.tenantId}/${s.source}`),
  };
}

describe("what a pass has to read", () => {
  it("offers a document nobody has read", async () => {
    await land("f1");

    expect(await backlog(NOW)).toEqual({ documentIds: ["f1"], scopes: [`${TENANT}/${SOURCE}`] });
  });

  it("offers a document read from bytes that have since changed", async () => {
    // A sha that no longer matches is the only signal the customer replaced the file.
    await land("f1");
    await extractedAt(NOW, [row("f1", { method: "pdf_text", reason: null, text: "a contract" })]);

    await db.query("UPDATE raw.documents SET sha256 = $1 WHERE document_id = 'f1'", [OTHER_SHA]);

    expect(await backlog(NOW)).toEqual({ documentIds: ["f1"], scopes: [`${TENANT}/${SOURCE}`] });
  });

  it("does not offer a document read from the bytes it still has", async () => {
    // The quiet side, and the one that decides the bill: without it every run re-reads the
    // tenant's whole catalogue, which for a real one is 252 MB of PDFs.
    await land("f1");
    await extractedAt(NOW, [row("f1", { method: "pdf_text", reason: null, text: "a contract" })]);

    expect(await backlog(NOW)).toEqual({ documentIds: [], scopes: [] });
  });

  it("never offers a tombstoned document", async () => {
    await land("gone");
    await db.query("UPDATE raw.documents SET deleted_at = now() WHERE document_id = 'gone'");

    expect(await backlog(NOW)).toEqual({ documentIds: [], scopes: [] });
  });
});

describe("a refusal, once the readers have changed", () => {
  it("is offered again when its generation is older than the one asking", async () => {
    // Without this a refusal is permanent: the row exists and the bytes have not moved, so the
    // 1,190 documents recorded `unsupported-content-type` would never meet the reader written
    // for them.
    await land("f1");
    await extractedAt(BEFORE, [row("f1")]);

    expect(await backlog(NOW)).toEqual({ documentIds: ["f1"], scopes: [`${TENANT}/${SOURCE}`] });
  });

  it("is not offered when its generation is the one asking", async () => {
    // The quiet side. A predicate that re-queued every refusal would pass the test above and
    // hand each run the same 1,190 documents for ever, at full cost.
    await land("f1");
    await extractedAt(NOW, [row("f1")]);

    expect(await backlog(NOW)).toEqual({ documentIds: [], scopes: [] });
  });

  it("leaves the backlog once this generation has had its go at it", async () => {
    // Re-queued, re-read, still refused -- and now stamped, so it stops being offered. The
    // write is what closes the loop; a pass that read the row without stamping it would offer
    // the same document to every run from here on.
    await land("f1");
    await extractedAt(BEFORE, [row("f1")]);

    await extractedAt(NOW, [row("f1", { reason: "docx-unreadable" })]);

    expect(await backlog(NOW)).toEqual({ documentIds: [], scopes: [] });
  });

  it("re-enters exactly once when the row predates the column entirely", async () => {
    // The 240 migration's `DEFAULT 0`. A row written before the column existed carries no
    // generation of its own, and must sort BELOW every generation -- a NULL would sort outside
    // `<` instead and mean "never retry" for precisely the rows this mechanism exists to reach.
    await land("f1");
    await db.query(
      `INSERT INTO raw.document_text
         (source, tenant_id, document_id, source_sha256, reason, extracted_at, run_id)
       VALUES ($1, $2, 'f1', $3, 'unsupported-content-type', now(), 'run-legacy')`,
      [SOURCE, TENANT, SHA],
    );

    expect(await backlog(NOW)).toEqual({ documentIds: ["f1"], scopes: [`${TENANT}/${SOURCE}`] });

    await extractedAt(NOW, [row("f1")]);
    expect(await backlog(NOW)).toEqual({ documentIds: [], scopes: [] });
  });
});

describe("the guard a generation bump is safe because of", () => {
  it("never re-offers a document that WAS read, however old its generation", async () => {
    // THE most important assertion in this module. A sibling project's worst extraction bug was
    // a cheap re-parse run overwriting 2,602 expensively-OCR'd documents with empty text, with
    // every gate green because the row count never changed. Their law -- never swap text for
    // empty; block it in code, not in the operator's memory -- is this test. Bumping the
    // constant must cost the refusals and nothing else.
    await land("f1");
    await extractedAt(BEFORE, [
      row("f1", { method: "image_ocr", reason: null, text: "hợp đồng dịch vụ" }),
    ]);

    expect(await backlog(NOW)).toEqual({ documentIds: [], scopes: [] });
  });

  it("not even when the row carries a caveat beside its method", async () => {
    // The scope is spelled `method IS NULL`, not `reason IS NOT NULL`. Those select the same
    // rows today -- the `document_text_said_why` CHECK makes one null exactly when the other is
    // not -- but a future reader recording text AND why it may be incomplete would be re-queued
    // by the `reason` spelling, and blanked by the next worse run. The same 2,602 documents
    // through a different door.
    await land("f1");
    await extractedAt(BEFORE, [
      row("f1", { method: "pdf_text", reason: "text-layer-partial", text: "a contract" }),
    ]);

    expect(await backlog(NOW)).toEqual({ documentIds: [], scopes: [] });
  });
});

describe("the grant on a column added later", () => {
  it("covers the worker, because its privilege is held on the table", async () => {
    // `privileges.md`'s "grant the table in the migration that creates it" is about new TABLES,
    // where `ON ALL TABLES` froze at migration time. A column is the opposite case: it gets no
    // ACL of its own and falls back to the relation's, so 180's table-level grant already
    // reaches it. Asserted rather than reasoned about -- this whole suite runs as the worker,
    // and every `extractedAt` above writes the column.
    await land("f1");
    await extractedAt(NOW, [row("f1")]);

    const { rows } = await db.query<{ reader_version: number }>(
      "SELECT reader_version FROM raw.document_text WHERE document_id = 'f1'",
    );
    expect(rows[0]?.reader_version).toBe(NOW);
  });

  it("does not cover the control plane, because its grant names columns", async () => {
    // The quiet side, and a PII boundary before it is anything else. 180 grants
    // `undercroft_app` eight named columns precisely so `text` is not among them; a column
    // scope does not widen to columns added later, and that is the property being pinned. If
    // this test ever goes green by someone adding a name to that list, the question to ask is
    // which name -- `pii.md`: never give `undercroft_app` `text`.
    await land("f1");
    await extractedAt(NOW, [row("f1")]);

    const refused = await db.asRole("undercroft_app", async (tx) => {
      try {
        await tx.query("SELECT reader_version FROM raw.document_text");
        return null;
      } catch (error) {
        return String(error);
      }
    });

    // "permission denied" rather than merely "it threw": a mistyped column name throws too,
    // and would make this pass while proving nothing about the grant.
    expect(refused).toContain("permission denied");
    // ...and a column it WAS granted still answers, so the assertion above is about the scope
    // and not about the role having lost the table.
    const granted = await db.asRole("undercroft_app", (tx) =>
      tx.query<{ reason: string | null }>("SELECT reason FROM raw.document_text"),
    );
    expect(granted.rows).toHaveLength(1);
  });
});
