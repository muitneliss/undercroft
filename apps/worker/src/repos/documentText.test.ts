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
  type AnsweredDocuments,
  type DocumentTextRow,
  pendingDocuments,
  pendingScopes,
  upsertDocumentText,
} from "./documentText.ts";

const TENANT = "CASE-0042";
/** A second customer, whose documents this module must never answer. */
const OTHER_TENANT = "CASE-0043";
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

/**
 * Catalogue a document the way an ingest run leaves it. The bytes themselves are not needed.
 *
 * `where` defaults to the one scope every other test uses; the tests about the boundary name a
 * different customer or a different source, which is what the write must not cross.
 */
async function land(
  documentId: string,
  sha256 = SHA,
  where: { tenantId?: string; source?: string } = {},
): Promise<void> {
  const tenantId = where.tenantId ?? TENANT;
  const source = where.source ?? SOURCE;
  await db.query(
    `INSERT INTO raw.documents
       (source, tenant_id, document_id, lake_key, sha256, byte_length, content_type,
        observed_at, run_id)
     VALUES ($1, $2, $3, $4, $5, '2048', 'application/pdf', now(), 'run-seed')`,
    [source, tenantId, documentId, `documents/${source}/${tenantId}/${documentId}`, sha256],
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
): Promise<AnsweredDocuments> {
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

/** Every row of text in the table, whoever it belongs to -- the fan-out's whole output. */
async function textRows(): Promise<
  {
    tenant_id: string;
    document_id: string;
    method: string | null;
    text: string;
    source_sha256: string;
    reader_version: number;
  }[]
> {
  const { rows } = await db.query<{
    tenant_id: string;
    document_id: string;
    method: string | null;
    text: string;
    source_sha256: string;
    reader_version: number;
  }>(
    `SELECT tenant_id, document_id, method, text, source_sha256, reader_version
       FROM raw.document_text ORDER BY tenant_id, document_id`,
  );
  return rows;
}

describe("documents that hold the same bytes", () => {
  it("offers ONE of them, because the read is about the bytes", async () => {
    // 4,476 rows over 2,030 digests on production: an attachment quoted down a reply chain is
    // one catalogue row per message, and reading it twice is a `pdftoppm` and thirty
    // `tesseract` children spent reproducing text we already hold verbatim.
    await land("f1");
    await land("f2");

    expect(await backlog(NOW)).toEqual({ documentIds: ["f1"], scopes: [`${TENANT}/${SOURCE}`] });
  });

  it("offers both when the digests differ", async () => {
    // The quiet side, and the one that says the collapse is keyed on CONTENT. A predicate that
    // offered one row per tenant would pass the test above by reading 1 of 2,030.
    await land("f1");
    await land("f2", OTHER_SHA);

    expect(await backlog(NOW)).toEqual({
      documentIds: ["f1", "f2"],
      scopes: [`${TENANT}/${SOURCE}`],
    });
  });

  it("writes the read to every one of them, at the generation that produced it", async () => {
    // The other half of the collapse. The sibling is not skipped, it is ANSWERED -- otherwise
    // `pendingDocuments` would simply hide documents from the run that has to read them.
    await land("f1");
    await land("f2");

    const answered = await extractedAt(NOW, [
      row("f1", { method: "pdf_text", reason: null, text: "hợp đồng dịch vụ" }),
    ]);

    // One read, two documents answered -- the number a run reports as `created`.
    expect(answered.get("f1")).toBe(2);
    expect(await textRows()).toEqual([
      {
        tenant_id: TENANT,
        document_id: "f1",
        method: "pdf_text",
        text: "hợp đồng dịch vụ",
        source_sha256: SHA,
        reader_version: NOW,
      },
      {
        tenant_id: TENANT,
        document_id: "f2",
        method: "pdf_text",
        text: "hợp đồng dịch vụ",
        source_sha256: SHA,
        reader_version: NOW,
      },
    ]);
    expect(await backlog(NOW)).toEqual({ documentIds: [], scopes: [] });
  });

  it("copies a refusal too, because identical bytes are refused identically", async () => {
    // Correct, and worth stating because it reads like the 2,602-document hazard and is not
    // one: that was a DIFFERENT toolchain blanking good text. These are the same bytes through
    // the same generation, and the row below carries that generation, so the next reader
    // re-queues them exactly as it re-queues the read one.
    await land("f1");
    await land("f2");

    await extractedAt(NOW, [row("f1")]);

    const rows = await textRows();
    expect(rows.map((r) => r.document_id)).toEqual(["f1", "f2"]);
    expect(rows.every((r) => r.method === null)).toBe(true);
    expect(await backlog(NOW + 1)).toEqual({
      documentIds: ["f1"],
      scopes: [`${TENANT}/${SOURCE}`],
    });
  });

  it("does NOT overwrite a sibling that was already read", async () => {
    // The 2,602-document guard, reached through the write rather than the backlog. The fan-out
    // is eligible for exactly the documents `PENDING_JOIN` would have offered a later run, so a
    // document carrying a method is untouched however cheap the pass beside it was.
    const kept = "read once, expensively";
    await land("f1");
    await land("f2");
    await db.query(
      `INSERT INTO raw.document_text
         (source, tenant_id, document_id, source_sha256, method, text, chars, extracted_at,
          run_id, reader_version)
       VALUES ($1, $2, 'f2', $3, 'pdf_ocr', $4, char_length($4), now(), 'run-old', $5)`,
      [SOURCE, TENANT, SHA, kept, NOW],
    );

    const answered = await extractedAt(NOW, [
      row("f1", { method: "pdf_text", reason: null, text: "a thinner reading" }),
    ]);

    expect(answered.get("f1")).toBe(1);
    const rows = await textRows();
    expect(rows.find((r) => r.document_id === "f2")?.text).toBe(kept);
    expect(rows.find((r) => r.document_id === "f1")?.text).toBe("a thinner reading");
  });
});

describe("a second customer holding byte-identical bytes", () => {
  it("is given NOTHING, and is still waiting to be read", async () => {
    // THE test this slice exists to be trusted on. The worker holds `platform_all ... USING
    // (true)` on both tables, so row-level security protects READERS and not this writer: a
    // copy across tenants would stamp one customer's contract with another's id, and the policy
    // would then serve it faithfully as theirs. Nothing raises. Nothing goes red. So the scope
    // is a bind parameter taken from the caller and never from the data, and this asserts the
    // consequence -- the other customer's document is untouched AND still pending, which is the
    // difference between "not copied" and "quietly retired".
    await land("f1");
    await land("f1", SHA, { tenantId: OTHER_TENANT });

    await extractedAt(NOW, [
      row("f1", { method: "pdf_text", reason: null, text: "another customer's contract" }),
    ]);

    expect(await textRows()).toEqual([
      {
        tenant_id: TENANT,
        document_id: "f1",
        method: "pdf_text",
        text: "another customer's contract",
        source_sha256: SHA,
        reader_version: NOW,
      },
    ]);
    const scopes = await pendingScopes(db, { readerVersion: NOW });
    expect(scopes).toEqual([{ tenantId: OTHER_TENANT, source: SOURCE }]);
  });

  it("IS answered by a pass of its own", async () => {
    // The quiet side. A write scoped so tightly that it reached nobody would pass the test
    // above and leave every tenant's backlog undrainable.
    await land("f1", SHA, { tenantId: OTHER_TENANT });

    await upsertDocumentText(
      db,
      { tenantId: OTHER_TENANT, source: SOURCE },
      [row("f1", { method: "pdf_text", reason: null, text: "their own contract" })],
      { extractedAt: "2026-09-20T09:00:00.000Z", runId: "run-extract-other", readerVersion: NOW },
    );

    expect((await textRows()).map((r) => r.tenant_id)).toEqual([OTHER_TENANT]);
    expect(await pendingScopes(db, { readerVersion: NOW })).toEqual([]);
  });
});

describe("the same customer's copy of the same bytes in another source", () => {
  it("is not answered either, because `source` is in the primary key", async () => {
    // The tenant tests would not catch this: dropping `source` from the write's scope writes a
    // row for a document id that exists under `gmail` but stamps it `drive`, inventing a
    // document nobody catalogued. Reusing a Gmail attachment's text for the same customer's
    // Drive copy may well be right; it is a SEPARATE argument, and until it is made the scope
    // stays the pair the primary key already uses.
    await land("f1");
    await land("f1", SHA, { source: "gmail" });

    await extractedAt(NOW, [row("f1", { method: "pdf_text", reason: null, text: "a contract" })]);

    const { rows } = await db.query<{ source: string }>(
      "SELECT source FROM raw.document_text ORDER BY 1",
    );
    expect(rows).toEqual([{ source: SOURCE }]);
  });
});

describe("the index the digest questions need", () => {
  it("indexes the scope first and the digest last", async () => {
    // `030_raw.sql` creates two indexes and both are on `raw.records`, so "rows sharing a
    // digest" was a sequential scan over the whole catalogue -- once per collapse and once per
    // fan-out. The column ORDER is the assertion: every statement pins source and tenant to one
    // value each, so they narrow the scan and the digest is what it is then matched by.
    const { rows } = await db.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'raw' AND indexname = 'documents_digest'",
    );

    expect(rows[0]?.indexdef).toContain("(source, tenant_id, sha256)");
  });

  it("carries no privileges of its own, and cannot be given any", async () => {
    // `250_documents_sha_idx.sql` records "no grant" as a FINDING. This is the evidence:
    // `privileges.md`'s rule is about tables, 240's was about a column, and an index is neither
    // -- it holds no ACL, it is never named in a query, and Postgres refuses the GRANT outright.
    const acls = await db.query<{ index_acl: string | null; table_acl: string | null }>(
      `SELECT (SELECT relacl::text FROM pg_class WHERE relname = 'documents_digest') AS index_acl,
              (SELECT relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'raw' AND c.relname = 'documents') AS table_acl`,
    );
    expect(acls.rows[0]?.index_acl).toBeNull();
    // ...and the table it indexes DOES carry one, so the null above is about indexes and not
    // about this database having no grants at all.
    expect(acls.rows[0]?.table_acl).toContain("undercroft_worker");

    const refused = await db.asSuperuser(async (tx) => {
      try {
        await tx.query("GRANT SELECT ON raw.documents_digest TO undercroft_worker");
        return "";
      } catch (error) {
        return String(error);
      }
    });
    expect(refused).toContain("is an index");
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
