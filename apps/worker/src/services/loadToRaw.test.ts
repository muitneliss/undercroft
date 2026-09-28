/**
 * What a projection leaves behind when it does not finish.
 *
 * The pass itself -- incremental, idempotent, resumable from the cursor -- is exercised
 * end to end in `handlers/lake.test.ts`. What is pinned here is the one thing only a
 * failure can show: a pass that dies partway keeps the batches it completed, so the next
 * run continues instead of starting the whole mailbox again.
 */

import { streamOf } from "@undercroft/contracts";
import { createStampSource, TestClock } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { readCursor } from "../repos/rawRecords.ts";
import { landRecords, type RecordToLand } from "./land.ts";
import { loadStreamToRaw } from "./loadToRaw.ts";

const IDENTITY = { source: "demo", tenantId: "CASE-0042", entity: "things" } as const;

/** The loader's own batch size. A partial pass is only observable either side of it. */
const BATCH = 500;

let backing: InMemoryObjectStore;
let lake: LakeStore;
let db: TestDatabase;

beforeEach(async () => {
  backing = new InMemoryObjectStore();
  lake = new LakeStore(backing, { stamps: createStampSource(new TestClock()) });
  db = await createMigratedTestDatabase();
  await db.exec("CREATE TABLE raw.records_demo PARTITION OF raw.records FOR VALUES IN ('demo')");
  // Seeded as the superuser; from here on every statement runs as the worker does.
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

function record(id: string, payloadText?: string): RecordToLand {
  return {
    entity: IDENTITY.entity,
    sourceRecordId: id,
    sourceUpdatedAt: "2026-09-21T09:00:00.000Z",
    payloadText: payloadText ?? JSON.stringify({ id }),
  };
}

async function land(records: readonly RecordToLand[]): Promise<void> {
  const result = await landRecords(lake, {
    source: IDENTITY.source,
    tenantId: IDENTITY.tenantId,
    runId: "run-1",
    records,
  });
  expect(result.failed).toBe(0);
}

async function stamps(): Promise<string[]> {
  const all: string[] = [];
  for await (const entry of lake.journalSince(streamOf(IDENTITY), null)) {
    all.push(entry.stamp);
  }
  return all;
}

async function projectedCount(): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM raw.records WHERE source = $1 AND tenant_id = $2",
    [IDENTITY.source, IDENTITY.tenantId],
  );
  return Number.parseInt(rows[0]?.n ?? "0", 10);
}

describe("loadStreamToRaw", () => {
  it("a pass that dies partway keeps the batches it completed", async () => {
    // The observation at index BATCH is unreadable as JSON, so the second batch's cast
    // fails and the pass raises where a killed process would have stopped. Everything the
    // first batch wrote is already in `raw.records`, and the cursor says so -- written once
    // at the end of the pass, as it used to be, both the rows and the reason to keep them
    // would be thrown away and re-read from the top on the next run.
    const source = Array.from({ length: BATCH + 5 }, (_, i) =>
      i === BATCH ? record(`id-${i}`, "not json at all") : record(`id-${i}`),
    );
    await land(source);

    await expect(loadStreamToRaw(db, lake, IDENTITY)).rejects.toThrow();

    expect(await projectedCount()).toBe(BATCH);
    expect(await readCursor(db, IDENTITY)).toBe((await stamps())[BATCH - 1] ?? "");
  });

  it("projecting a stream lists once, not once per record", async () => {
    // The cost of a pass IS its round trips, and this is the one that was quadratic in
    // attention if not in complexity: the loader asked the lake for the manifest, then for
    // the bytes -- which LISTed the key's observations to choose a stamp the journal entry
    // it was holding already named, and read the manifest a second time. Per record that
    // was one LIST and four GETs; 7,786 records was the phase that went silent for eight
    // minutes. Now a pass LISTs once, for the journal itself, and reads each observation
    // with the journal pointer plus one manifest plus one blob.
    const n = 20;
    await land(Array.from({ length: n }, (_, i) => record(`id-${i}`)));

    const before = backing.calls;
    await loadStreamToRaw(db, lake, IDENTITY);
    const after = backing.calls;

    expect(after.list - before.list).toBe(1);
    // A ceiling, not an exact count: the old path was four GETs a record, and a pass that
    // needs fewer than three is an improvement nobody should have to edit this test to make.
    expect(after.get - before.get).toBeLessThanOrEqual(3 * n);
  });

  it("a pass that completes leaves the cursor at the last observation it read", async () => {
    // The quiet side: moving the cursor per batch must still reach the end of the pass, or
    // every run would re-read the tail of the stream for ever.
    await land([record("id-0"), record("id-1"), record("id-2")]);

    const result = await loadStreamToRaw(db, lake, IDENTITY);

    expect(result).toMatchObject({ created: 3, changed: 0, unchanged: 0 });
    expect(await readCursor(db, IDENTITY)).toBe((await stamps()).at(-1) ?? "");
  });

  it("a record changed twice within one pass projects its newest version", async () => {
    // Regression: both versions sat in one batch, the UPDATE ... FROM matched the held row
    // twice, and Postgres applied whichever it met first -- the older one. The cursor then
    // moved past both, so the row stayed stale until the record next changed.
    await land([record("x", JSON.stringify({ v: 1 }))]);
    await loadStreamToRaw(db, lake, IDENTITY);
    await land([record("x", JSON.stringify({ v: 2 })), record("x", JSON.stringify({ v: 3 }))]);

    await loadStreamToRaw(db, lake, IDENTITY);

    const { rows } = await db.query<{ payload: unknown }>(
      "SELECT payload FROM raw.records WHERE source = $1 AND source_record_id = 'x'",
      [IDENTITY.source],
    );
    expect(rows).toEqual([{ payload: { v: 3 } }]);
  });
});

describe("a manifest's sourceUpdatedAt reaches a timestamptz column", () => {
  async function stampedAt(): Promise<Record<string, string | null>> {
    const { rows } = await db.query<{ id: string; at: string | null }>(
      "SELECT source_record_id AS id, source_updated_at::text AS at FROM raw.records ORDER BY id",
    );
    return Object.fromEntries(rows.map((row) => [row.id, row.at]));
  }

  it("reads a Microsoft JSON date that a manifest already carries", async () => {
    // What Xero's first run landed before #265 was fixed. The lake is create-only, so those
    // manifests stay as written, and re-landing the same bytes is `unchanged` -- it writes no
    // new one. Every pass that meets them has to read them.
    await land([{ ...record("xero"), sourceUpdatedAt: "/Date(1573755038314+0000)/" }]);

    await loadStreamToRaw(db, lake, IDENTITY);

    expect(await stampedAt()).toEqual({ xero: "2019-11-14 18:10:38.314+00" });
  });

  it("projects one that names no instant as NULL rather than stopping the stream", async () => {
    // One bad value held a whole stream's projection back for ever: the cursor never passed
    // the batch that carried it.
    await land([{ ...record("garbled"), sourceUpdatedAt: "last Tuesday" }, record("fine")]);

    await loadStreamToRaw(db, lake, IDENTITY);

    expect(await stampedAt()).toEqual({ fine: "2026-09-21 09:00:00+00", garbled: null });
  });
});
