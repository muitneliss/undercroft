/**
 * What a sink promises, stated as behaviour a caller can see.
 *
 * The promise under all of these is that the worker's memory is flat in the size of the
 * source. That cannot be asserted directly without reaching inside the sink, so it is
 * asserted at the lake and at `ops.run_refusal`: what the sink is not holding is what has
 * already been written, and both are readable while the sink is still open.
 */

import { streamOf } from "@undercroft/contracts";
import { createStampSource, TestClock } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { openRun } from "@undercroft/db/repos";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { landRecords, type RecordToLand } from "./land.ts";
import type { DocumentToLand } from "./landDocument.ts";
import {
  CHUNK,
  createDocumentSink,
  createRecordSink,
  type DocumentLanding,
  refusalsToRun,
} from "./landing.ts";

const TENANT = "CASE-0042";
const SOURCE = "demo";
const ENTITY = "things";
const RUN = "run-landing-1";
const OBSERVED_AT = "2026-09-21T12:00:00.000Z";

const AT: DocumentLanding = {
  source: SOURCE,
  tenantId: TENANT,
  runId: RUN,
  observedAt: OBSERVED_AT,
};

/** Invented inline: no real document enters the repo. */
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n%%EOF\n");

let backing: InMemoryObjectStore;
let lake: LakeStore;
let db: TestDatabase;

beforeEach(async () => {
  backing = new InMemoryObjectStore();
  lake = new LakeStore(backing, { stamps: createStampSource(new TestClock()) });
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.exec(
    `CREATE TABLE raw.records_demo PARTITION OF raw.records FOR VALUES IN ('${SOURCE}')`,
  );
  // Seeded as the superuser; from here on every statement runs as the worker does, so a
  // missing grant fails in the gate rather than at 02:00.
  await db.become("undercroft_worker");
  await openRun(db, {
    id: RUN,
    tenantId: TENANT,
    source: SOURCE,
    verb: "ingest",
    trigger: "manual",
  });
});

afterEach(async () => {
  await db.close();
});

function record(id: string): RecordToLand {
  return {
    entity: ENTITY,
    sourceRecordId: id,
    sourceUpdatedAt: "2026-09-21T09:00:00.000Z",
    payloadText: JSON.stringify({ id, total: "10.0000" }),
  };
}

function document(over: Partial<DocumentToLand> = {}): DocumentToLand {
  return {
    documentId: "19a2f:001",
    contentType: "application/pdf",
    declaredBytes: String(PDF.byteLength),
    metadata: { partIndex: 1, labelIds: ["Label_8"] },
    manifest: { filename: "invoice-0042.pdf", subject: "Invoice 0042" },
    sourceUpdatedAt: "2026-09-21T09:00:00.000Z",
    fetchBytes: (): Promise<Uint8Array> => Promise.resolve(PDF),
    ...over,
  };
}

/** How many observations the lake holds for the stream. Readable while a sink is open. */
async function inLake(): Promise<number> {
  const stream = streamOf({ source: SOURCE, tenantId: TENANT, entity: ENTITY });
  const stamps: string[] = [];
  for await (const entry of lake.journalSince(stream, null)) {
    stamps.push(entry.stamp);
  }
  return stamps.length;
}

/** How many records the projection holds. The other half of what a sink must leave behind. */
async function inRawRecords(): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM raw.records WHERE source = $1 AND tenant_id = $2",
    [SOURCE, TENANT],
  );
  return Number.parseInt(rows[0]?.n ?? "0", 10);
}

async function refusals(): Promise<{ entity: string; id: string; reason: string }[]> {
  const { rows } = await db.query<{ entity: string; id: string; reason: string }>(
    `SELECT entity, source_record_id AS id, reason FROM ops.run_refusal
     WHERE run_id = $1 ORDER BY source_record_id`,
    [RUN],
  );
  return rows;
}

async function documentRows(): Promise<{ document_id: string; metadata: unknown }[]> {
  const { rows } = await db.query<{ document_id: string; metadata: unknown }>(
    "SELECT document_id, metadata FROM raw.documents WHERE tenant_id = $1 ORDER BY document_id",
    [TENANT],
  );
  return rows;
}

function sink(chunk?: number) {
  return createRecordSink({ lake, exec: db, refuse: refusalsToRun(db, RUN) }, AT, chunk);
}

describe("a record sink lands a source it never holds", () => {
  it("a source larger than one chunk lands every record", async () => {
    const source = Array.from({ length: CHUNK * 2 + 50 }, (_, i) => record(`id-${i}`));
    const records = sink();

    for (const one of source) {
      await records.add(one);
    }
    const summary = await records.close();

    expect(summary).toEqual({
      landed: source.length,
      created: source.length,
      unchanged: 0,
      refused: 0,
    });
    expect(await inLake()).toBe(source.length);
  });

  it("each chunk is in the lake before the next one is read", async () => {
    // The memory promise, in the only form a caller can observe: two full chunks are already
    // landed while the sink is still open, so what it is holding is the 50 after them and not
    // the 450 it was given. Buffering the whole source -- the shape that was oom-killed on
    // 2026-09-21 -- would read zero here.
    const records = sink();

    for (let i = 0; i < CHUNK * 2 + 50; i += 1) {
      await records.add(record(`id-${i}`));
    }

    expect(await inLake()).toBe(CHUNK * 2);

    await records.close();
    expect(await inLake()).toBe(CHUNK * 2 + 50);
  });

  it("an incomplete chunk waits for close, and close lands it", async () => {
    // The quiet side of the same boundary: a sink does not flush per record, which is what
    // makes the chunk a bound rather than a formality.
    const records = sink();

    await records.add(record("id-0"));
    expect(await inLake()).toBe(0);

    const summary = await records.close();
    expect(summary.landed).toBe(1);
    expect(await inLake()).toBe(1);
  });

  it("a record that cannot be keyed is refused with its reason, and its chunk still lands", async () => {
    // `..` is what the lake refuses: a source id that traverses would land the record over a
    // container key. The refusal is the point -- the two records beside it in the chunk are
    // landed, because one bad record must never cost the chunk it arrived in.
    const records = sink(3);

    await records.add(record("id-0"));
    await records.add(record(".."));
    await records.add(record("id-1"));
    const summary = await records.close();

    expect(summary).toEqual({ landed: 2, created: 2, unchanged: 0, refused: 1 });
    expect(await refusals()).toEqual([
      { entity: ENTITY, id: "..", reason: expect.stringContaining("must not traverse") },
    ]);
  });

  it("a refusal is in the ledger before the run that made it has closed", async () => {
    // A run that dies must still leave behind what it refused. Held until `settle`, as they
    // were, the evidence died with the process that had it.
    const records = sink(2);

    await records.add(record(".."));
    await records.add(record("id-0"));

    expect(await refusals()).toHaveLength(1);

    await records.close();
  });

  it("a sink refuses a record added after it closed", async () => {
    // Nothing would ever land it: `close` has already flushed. Refusing says so rather than
    // dropping it silently.
    const records = sink();
    await records.close();

    await expect(records.add(record("id-0"))).rejects.toThrow("closed");
  });

  it("re-landing an unchanged source writes nothing and reports it", async () => {
    // Content idempotence, reached through the sink. Without it an hourly schedule pushes
    // real history out through retention using copies of the same record.
    const first = sink(2);
    await first.add(record("id-0"));
    await first.add(record("id-1"));
    await first.close();

    const second = sink(2);
    await second.add(record("id-0"));
    await second.add(record("id-1"));
    const summary = await second.close();

    expect(summary).toEqual({ landed: 2, created: 0, unchanged: 2, refused: 0 });
    expect(await inLake()).toBe(2);
  });
});

describe("a chunk that landed is a chunk the next run can skip", () => {
  it("a chunk is in raw.records before the sink that landed it is closed", async () => {
    // The resume promise, in the form a caller can see. What the next run skips is what
    // `raw.records` holds, so a run killed at minute 70 must have left its chunks THERE and
    // not only in the lake -- projecting at the end of the entity leaves 7,786 objects
    // nobody will skip.
    const records = sink(3);

    await records.add(record("id-0"));
    await records.add(record("id-1"));
    await records.add(record("id-2"));

    expect(await inRawRecords()).toBe(3);

    await records.close();
  });

  it("a chunk that has not landed is not projected either", async () => {
    // The quiet side: the projection follows the landing rather than running per record.
    // A row in `raw.records` for a record whose bytes are not in the lake would be a row
    // the next run skips on the strength of an archive entry that does not exist.
    const records = sink(3);

    await records.add(record("id-0"));
    await records.add(record("id-1"));
    expect(await inRawRecords()).toBe(0);

    await records.close();
    expect(await inRawRecords()).toBe(2);
  });

  it("the first chunk carries what a dead run left in the lake but never projected", async () => {
    // Recovery, and the reason there is no separate catch-up call to forget: the projection
    // resumes from `raw.load_cursor`, so the first chunk of the NEXT run sweeps up whatever
    // the killed one landed. Landing without a sink is exactly what a run that died before
    // its first flush left behind.
    await landRecords(lake, {
      source: SOURCE,
      tenantId: TENANT,
      runId: "run-that-died",
      records: [record("id-orphan-0"), record("id-orphan-1")],
    });
    expect(await inRawRecords()).toBe(0);

    const records = sink(1);
    await records.add(record("id-0"));
    await records.close();

    expect(await inRawRecords()).toBe(3);
  });
});

describe("a document sink catalogues what it lands, as it lands it", () => {
  function documents(chunk?: number) {
    return createDocumentSink({ lake, exec: db, refuse: refusalsToRun(db, RUN) }, AT, chunk);
  }

  it("a document is catalogued in the chunk that landed it, before close", async () => {
    // The row and the bytes are written in one pass, which is what removes the re-join over
    // every document in the harvest that used to follow the landing.
    const docs = documents(2);

    await docs.add(document({ documentId: "doc-1" }));
    await docs.add(document({ documentId: "doc-2" }));

    expect((await documentRows()).map((r) => r.document_id)).toEqual(["doc-1", "doc-2"]);

    const summary = await docs.close();
    expect(summary).toEqual({ landed: 2, created: 2, unchanged: 0, skipped: 0, failed: 0 });
  });

  it("the catalogue carries opaque metadata and never a filename", async () => {
    // `raw.documents` is granted to the dbt role, so every column here is one `dbt run` from
    // a dashboard. The name a human wrote goes to the lake manifest, which dbt cannot reach.
    // `.claude/rules/pii.md`, ADR 0015.
    const docs = documents(1);
    await docs.add(document({ documentId: "doc-1" }));
    await docs.close();

    const [row] = await documentRows();

    expect(row?.metadata).toEqual({
      partIndex: 1,
      labelIds: ["Label_8"],
      sourceUpdatedAt: "2026-09-21T09:00:00.000Z",
    });
    const key = `documents/${SOURCE}/${TENANT}/doc-1`;
    const newest = (await lake.versions(key)).at(-1) ?? "";
    expect((await lake.manifest(key, newest)).filename).toBe("invoice-0042.pdf");
  });

  it("a document refused before its bytes were fetched gets a reason and no row", async () => {
    // The firing side of "only what reached the lake is catalogued": a skipped document has
    // no bytes to point at, and a row claiming otherwise is worse than no row.
    const docs = documents(2);

    await docs.add(document({ documentId: "doc-1" }));
    await docs.add(
      document({
        documentId: "doc-huge",
        declaredBytes: "999999999999999999999",
        fetchBytes: (): Promise<Uint8Array> => Promise.reject(new Error("must not be fetched")),
      }),
    );
    const summary = await docs.close();

    expect(summary).toMatchObject({ created: 1, skipped: 1, failed: 0 });
    expect((await documentRows()).map((r) => r.document_id)).toEqual(["doc-1"]);
    expect(await refusals()).toEqual([
      { entity: "documents", id: "doc-huge", reason: expect.stringContaining("over the") },
    ]);
  });
});
