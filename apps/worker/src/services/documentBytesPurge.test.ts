/**
 * The operator's one-off for documents landed before ADR 0161, through its public seam, on PGlite
 * and an in-memory lake, as the worker's role.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { createStampSource, TestClock } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { purgeDocumentBytes } from "./documentBytesPurge.ts";

const TENANT = "CASE-0042";

let db: TestDatabase;
let lake: LakeStore;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

/** A Drive file as a landing before ADR 0161 left it: its name in the manifest alone. */
async function landedBefore(documentId: string, read: boolean): Promise<string> {
  const lakeKey = `documents/drive/${TENANT}/${documentId}`;
  const bytes = new TextEncoder().encode(`%PDF ${documentId}`);
  const put = await lake.put(lakeKey, bytes, {
    runId: "run-old",
    extra: { filename: `statement-${documentId}.pdf`, pickedFrom: "2026 statements" },
  });
  await db.query(
    `INSERT INTO raw.documents
       (source, tenant_id, document_id, lake_key, sha256, byte_length, content_type,
        observed_at, run_id)
     VALUES ('drive', $1, $2, $3, $4, $5, 'application/pdf', now(), 'run-old')`,
    [TENANT, documentId, lakeKey, put.sha256, String(bytes.byteLength)],
  );
  if (read) {
    await db.query(
      `INSERT INTO raw.document_text
         (source, tenant_id, document_id, source_sha256, method, text, chars, extracted_at, run_id)
       VALUES ('drive', $1, $2, $3, 'pdf_text', 'a page', 6, now(), 'run-old')`,
      [TENANT, documentId, put.sha256],
    );
  }
  return lakeKey;
}

async function documents(): Promise<unknown[]> {
  const { rows } = await db.query(
    `SELECT document_id, file_name, source_url, bytes_purge_outcome
       FROM raw.documents ORDER BY document_id`,
  );
  return rows;
}

describe("purging the documents landed before ADR 0161", () => {
  it("a dry run changes nothing and says what it would do, and why it would keep the rest", async () => {
    const readKey = await landedBefore("f1", true);
    await landedBefore("f2", false);
    const before = await documents();

    const outcome = await purgeDocumentBytes({ exec: db, lake }, { apply: false, tenantId: null });

    expect(await documents()).toEqual(before);
    expect(await lake.read(readKey)).toBeInstanceOf(Uint8Array);
    expect(outcome.traces).toMatchObject([{ source: "drive", documents: 2, traced: 0 }]);
    expect(outcome.outlook).toEqual([
      {
        tenantId: TENANT,
        purged: 0,
        purgeableDigests: 1,
        purgeableDocuments: 1,
        purgeableBytes: "7",
        kept: [{ because: "never-read", documents: 1 }],
      },
    ]);
  });

  it("an apply names each document from its manifest, purges what was read, and is done after", async () => {
    const readKey = await landedBefore("f1", true);
    await landedBefore("f2", false);

    const outcome = await purgeDocumentBytes({ exec: db, lake }, { apply: true, tenantId: TENANT });

    expect(outcome.purged).toMatchObject({ digests: 1, documents: 1, bytes: 7 });
    expect(await documents()).toEqual([
      {
        document_id: "f1",
        file_name: "statement-f1.pdf",
        source_url: "https://drive.google.com/file/d/f1/view",
        bytes_purge_outcome: "deleted",
      },
      {
        document_id: "f2",
        file_name: "statement-f2.pdf",
        source_url: "https://drive.google.com/file/d/f2/view",
        bytes_purge_outcome: null,
      },
    ]);
    await expect(lake.read(readKey)).rejects.toThrow(/purged/u);

    const again = await purgeDocumentBytes({ exec: db, lake }, { apply: true, tenantId: TENANT });
    expect(again.purged.digests).toBe(0);
    expect(again.traces).toEqual([]);
  });
});
