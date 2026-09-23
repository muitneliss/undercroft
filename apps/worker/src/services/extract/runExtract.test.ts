/**
 * The extract pass, end to end and entirely offline.
 *
 * Real PGlite, a real in-memory lake, and a spawn that answers the way poppler would -- so
 * this suite runs with no poppler installed, which is what the offline gate demands. It runs
 * as `undercroft_worker`, so a missing grant on the new table fails here rather than at 02:00.
 */

import { createStampSource, TestClock } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import type { Spawn } from "../transform.ts";
import { runExtract } from "./runExtract.ts";

const TENANT = "CASE-0042";
const SOURCE = "drive";
const A_PAGE =
  "Acme Holdings agrees to supply the services described in schedule one, " +
  "invoiced monthly in arrears, for a term of twelve months from the commencement date.";

let db: TestDatabase;
let lake: LakeStore;
let spawned: string[][];

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  spawned = [];
  // From here every statement runs as the worker does in production.
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

/** A spawn that answers as `pdftotext` would, and records that it was reached. */
function spawnAnswering(output: string): Spawn {
  return (cmd) => {
    spawned.push([...cmd]);
    return Promise.resolve({ exitCode: 0, output });
  };
}

/** Land bytes in the lake and catalogue them, the way an ingest run leaves them. */
async function landDocument(input: {
  documentId: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<string> {
  const lakeKey = `documents/${SOURCE}/${TENANT}/${input.documentId}`;
  const put = await lake.put(lakeKey, input.bytes, { runId: "run-seed" });
  await db.query(
    `INSERT INTO raw.documents
       (source, tenant_id, document_id, lake_key, sha256, byte_length, content_type,
        observed_at, run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), 'run-seed')`,
    [
      SOURCE,
      TENANT,
      input.documentId,
      lakeKey,
      put.sha256,
      String(input.bytes.byteLength),
      input.contentType,
    ],
  );
  return put.sha256;
}

function extract(spawn: Spawn, runId = "run-extract-1") {
  return runExtract({ exec: db, lake, spawn }, { tenantId: TENANT, source: SOURCE, runId });
}

async function textRows(): Promise<
  {
    document_id: string;
    method: string | null;
    reason: string | null;
    text: string;
    chars: number;
  }[]
> {
  const { rows } = await db.query<{
    document_id: string;
    method: string | null;
    reason: string | null;
    text: string;
    chars: number;
  }>("SELECT document_id, method, reason, text, chars FROM raw.document_text ORDER BY document_id");
  return rows;
}

describe("a pass over landed documents", () => {
  it("reads what it can and records HOW, against the bytes it read", async () => {
    await landDocument({
      documentId: "f1",
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
      contentType: "application/pdf",
    });

    const result = await extract(spawnAnswering(A_PAGE));

    expect(result).toMatchObject({ read: 1, refused: 0, unreadable: 0 });
    const rows = await textRows();
    expect(rows[0]?.method).toBe("pdf_text");
    expect(rows[0]?.reason).toBeNull();
    expect(rows[0]?.text).toBe(A_PAGE);
    expect(rows[0]?.chars).toBeGreaterThan(80);
  });

  it("gives a document it cannot read a REASON, never an absent row", async () => {
    // An absent row means "not read yet" and puts the document back in the next run's queue
    // forever, at full cost. The reason is what stops that.
    await landDocument({
      documentId: "f2",
      bytes: new TextEncoder().encode("\xd0\xcf\x11\xe0legacy"),
      contentType: "application/msword",
    });

    const result = await extract(spawnAnswering(A_PAGE));

    expect(result).toMatchObject({ read: 0, refused: 1 });
    const rows = await textRows();
    expect(rows[0]?.method).toBeNull();
    expect(rows[0]?.reason).toBe("legacy-doc-unsupported");
    // And the run hands the same refusal, with its reason, to the ledger -- not only a count.
    // Before that, `ops.run.refused` carried a number with nothing behind it. ADR 0039.
    expect(result.refusals).toEqual([
      { entity: "documents", sourceRecordId: "f2", reason: "legacy-doc-unsupported" },
    ]);
  });
});

describe("a second pass", () => {
  it("does nothing when the bytes have not moved", async () => {
    // The mechanism that makes this verb schedulable. Without it every run re-reads the whole
    // catalogue, which for a real tenant is 252 MB of PDFs.
    await landDocument({
      documentId: "f1",
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
      contentType: "application/pdf",
    });
    await extract(spawnAnswering(A_PAGE));
    const afterFirst = spawned.length;

    const second = await extract(spawnAnswering(A_PAGE), "run-extract-2");

    expect(second).toMatchObject({ read: 0, refused: 0, unreadable: 0 });
    expect(spawned).toHaveLength(afterFirst);
    expect(await textRows()).toHaveLength(1);
  });

  it("re-reads a document whose bytes changed", async () => {
    // The firing side of the same guard: a sha that no longer matches is the only signal
    // that the customer replaced the file.
    const documentId = "f1";
    await landDocument({
      documentId,
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
      contentType: "application/pdf",
    });
    await extract(spawnAnswering("first version of the agreement, at some length, to pass"));

    // The same document, new bytes: what a re-ingest of an edited file leaves behind.
    await db.asSuperuser((tx) =>
      tx.query("UPDATE raw.documents SET sha256 = $1 WHERE document_id = $2", [
        "f".repeat(64),
        documentId,
      ]),
    );
    const second = await extract(spawnAnswering(A_PAGE), "run-extract-2");

    expect(second.read).toBe(1);
    const { rows } = await db.query<{ source_sha256: string; run_id: string }>(
      "SELECT source_sha256, run_id FROM raw.document_text",
    );
    expect(rows[0]?.source_sha256).toBe("f".repeat(64));
    expect(rows[0]?.run_id).toBe("run-extract-2");
  });
});

describe("a pass after the readers changed", () => {
  /**
   * Land a document, read it once, then age its row to the generation before this one --
   * which is what a release that bumps `CURRENT_READER_VERSION` does to every existing row.
   */
  async function aged(input: { documentId: string; contentType: string }): Promise<void> {
    await landDocument({
      documentId: input.documentId,
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
      contentType: input.contentType,
    });
    await extract(spawnAnswering(A_PAGE));
    await db.asSuperuser((tx) =>
      tx.query("UPDATE raw.document_text SET reader_version = reader_version - 1"),
    );
  }

  it("re-reads a refusal, and stamps it so the pass after that does not", async () => {
    // The whole point of the slice, end to end: 1,190 documents on production are recorded
    // `unsupported-content-type` for types this platform can now read, and a refusal with
    // unchanged bytes is otherwise permanent. `runExtract` must ask and stamp with ONE
    // generation -- asking with an older number than it writes would loop this document for
    // ever, and the reverse would retire it before any reader looked at it.
    await aged({ documentId: "f2", contentType: "application/msword" });

    const second = await extract(spawnAnswering(A_PAGE), "run-extract-2");
    const third = await extract(spawnAnswering(A_PAGE), "run-extract-3");

    expect(second).toMatchObject({ read: 0, refused: 1 });
    expect(third).toMatchObject({ read: 0, refused: 0, unreadable: 0 });
    expect((await textRows())[0]?.reason).toBe("legacy-doc-unsupported");
  });
});

describe("the same bytes catalogued several times", () => {
  it("spawns ONE reader and answers both documents", async () => {
    // The whole slice, end to end. Production holds 4,476 documents over 2,030 digests, and
    // since the OCR readers landed a thirty-page duplicate scan is thirty-one child processes
    // spent reproducing text we hold verbatim. `read` stays a count of DOCUMENTS -- it is what
    // `job.ts` records as the run's `created` -- so the saving shows as the spawn count, not as
    // a number that halved. That the sibling is then off the backlog, and that another
    // customer's copy is never answered, are the repo's to prove (`documentText.test.ts`).
    //
    // The same attachment quoted down a reply chain: one row per message, one set of bytes.
    const bytes = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    for (const documentId of ["msg-1:2", "msg-2:2"]) {
      await landDocument({ documentId, bytes, contentType: "application/pdf" });
    }

    const result = await extract(spawnAnswering(A_PAGE));

    expect(spawned).toHaveLength(1);
    expect(result).toMatchObject({ read: 2, refused: 0, unreadable: 0 });
    const rows = await textRows();
    expect(rows.map((r) => r.document_id)).toEqual(["msg-1:2", "msg-2:2"]);
    expect(rows.every((r) => r.method === "pdf_text")).toBe(true);
  });
});

describe("a document the lake cannot hand back", () => {
  it("is recorded against the document rather than ending the pass", async () => {
    // One unreadable object must not cost the other 499 their run.
    await db.query(
      `INSERT INTO raw.documents
         (source, tenant_id, document_id, lake_key, sha256, byte_length, content_type,
          observed_at, run_id)
       VALUES ($1, $2, 'ghost', 'documents/drive/CASE-0042/ghost', $3, '10',
               'application/pdf', now(), 'run-seed')`,
      [SOURCE, TENANT, "a".repeat(64)],
    );

    const result = await extract(spawnAnswering(A_PAGE));

    expect(result.unreadable).toBe(1);
    expect((await textRows())[0]?.reason).toBe("lake-object-unreadable");
  });
});

describe("who may read the text", () => {
  // Land a row, then provision both tenants so their own dbt logins exist. Every test below
  // only reads what this leaves; they differ in who is asking.
  beforeEach(async () => {
    await landDocument({
      documentId: "f1",
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
      contentType: "application/pdf",
    });
    await extract(spawnAnswering(A_PAGE));
    await db.asSuperuser(async (tx) => {
      await tx.query("INSERT INTO ops.tenant (id) VALUES ('CASE-0043')");
      await tx.query("SELECT ops.provision_tenant($1)", [TENANT]);
      await tx.query("SELECT ops.provision_tenant('CASE-0043')");
    });
  });

  it("a tenant's own dbt role reads its own text -- the point of the table", async () => {
    // ADR 0024, and proven rather than assumed: `040_grants.sql` expanded ON ALL TABLES when
    // it ran and never runs again, and `ops.provision_tenant` grants raw BY TABLE NAME -- so
    // a table added later is invisible to every tenant unless both are dealt with.
    const seen = await db.asRole("undercroft_dbt_case_0042", (tx) =>
      tx.query<{ n: string }>("SELECT count(*)::text AS n FROM raw.document_text"),
    );

    expect(seen.rows[0]?.n).toBe("1");
  });

  it("another tenant's dbt role reads NONE of it", async () => {
    // The row-level policy, and the reason this table cannot ship without one: the grant says
    // which ROLES may read the table, only the policy says which ROWS, and the rows here are
    // the full text of somebody's contracts.
    const seen = await db.asRole("undercroft_dbt_case_0043", (tx) =>
      tx.query<{ n: string }>("SELECT count(*)::text AS n FROM raw.document_text"),
    );

    expect(seen.rows[0]?.n).toBe("0");
  });

  it("the legacy shared dbt role reads none of it either", async () => {
    // It matches no tenant, so `raw.tenant_of(current_user)` answers nothing and the policy
    // shows it zero rows -- the same answer 080 documents for `raw.records`.
    const seen = await db.asRole("undercroft_dbt", (tx) =>
      tx.query<{ n: string }>("SELECT count(*)::text AS n FROM raw.document_text"),
    );

    expect(seen.rows[0]?.n).toBe("0");
  });
});

/**
 * The half that made a 245-refusal run unexplainable.
 *
 * Before this, a refused document's reason reached `raw.document_text` and nothing else, so
 * `ops.run.refused` carried a number with nothing behind it and the journal's refusals table
 * was not drawn at all. ADR 0039.
 */
describe("what a pass hands the ledger", () => {
  it("counts the refusals by reason, biggest first", async () => {
    // The rollup is what survives the 7-day prune, so it is the thing that must be right
    // even when every per-record row beneath it is gone.
    // Distinct bytes, so these are two reads rather than one read answering two documents.
    // The weighting is covered on its own below.
    for (const id of ["a1", "a2"]) {
      await landDocument({
        documentId: id,
        bytes: new TextEncoder().encode(`\xd0\xcf\x11\xe0legacy ${id}`),
        contentType: "application/msword",
      });
    }
    await landDocument({
      documentId: "b1",
      bytes: new TextEncoder().encode("plain"),
      contentType: "application/x-nobody-reads-this",
    });

    const result = await extract(spawnAnswering(A_PAGE));

    expect(result.reasonCounts).toEqual([
      { entity: "documents", reason: "legacy-doc-unsupported", count: 2 },
      { entity: "documents", reason: "unsupported-content-type", count: 1 },
    ]);
  });

  it("reports the whole queue behind it, not the batch it took", async () => {
    // `pending.length` is capped at the batch, so on a tenant with a backlog it reads 500
    // every time and says nothing about whether the backlog is draining. That difference is
    // what tells a healthy drain from a fault.
    // Distinct bytes per document, so each is its own read: this test is about the QUEUE, and
    // identical bytes would collapse to one read and measure the fan-out instead.
    for (const id of ["q1", "q2", "q3"]) {
      await landDocument({
        documentId: id,
        bytes: new TextEncoder().encode(`%PDF-1.7\n% ${id}\n%%EOF\n`),
        contentType: "application/pdf",
      });
    }

    const result = await runExtract(
      { exec: db, lake, spawn: spawnAnswering(A_PAGE), batch: 1 },
      { tenantId: TENANT, source: SOURCE, runId: "run-extract-batch" },
    );

    expect(result.read).toBe(1);
    expect(result.pendingBefore).toBe(3);
  });

  it("counts a reason in DOCUMENTS, so the rollup adds up to what the run refused", async () => {
    // One read answers every document holding those bytes (`upsertDocumentText` fans out), and
    // the rollup is what a reader presses into after reading "3 refused". Counting reads would
    // print 1 under a heading that says 3, with nothing to explain the difference.
    for (const id of ["dup1", "dup2", "dup3"]) {
      await landDocument({
        documentId: id,
        bytes: new TextEncoder().encode("\xd0\xcf\x11\xe0the same legacy bytes"),
        contentType: "application/msword",
      });
    }

    const result = await extract(spawnAnswering(A_PAGE));

    expect(result.refused).toBe(3);
    expect(result.reasonCounts).toEqual([
      { entity: "documents", reason: "legacy-doc-unsupported", count: 3 },
    ]);
    // And the ledger's own list is the distinct FILES, which is why the interface captions it
    // that way rather than claiming a row per document.
    expect(result.refusals).toHaveLength(1);
  });

  it("reports an empty queue as 0 rather than as no answer", async () => {
    // The quiet half of the guard above: 0 here is a real measurement of an empty queue, and
    // it must not be confused with "this verb has no queue", which is the NULL column.
    const result = await extract(spawnAnswering(A_PAGE));

    expect(result.pendingBefore).toBe(0);
    expect(result.reasonCounts).toEqual([]);
  });
});
