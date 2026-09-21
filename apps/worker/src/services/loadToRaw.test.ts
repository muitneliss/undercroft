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
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
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
  db = await createTestDatabase();
  await migrate(db);
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
    expect(after.get - before.get).toBe(3 * n);
  });

  it("a pass that completes leaves the cursor at the last observation it read", async () => {
    // The quiet side: moving the cursor per batch must still reach the end of the pass, or
    // every run would re-read the tail of the stream for ever.
    await land([record("id-0"), record("id-1"), record("id-2")]);

    const result = await loadStreamToRaw(db, lake, IDENTITY);

    expect(result).toMatchObject({ created: 3, changed: 0, unchanged: 0 });
    expect(await readCursor(db, IDENTITY)).toBe((await stamps()).at(-1) ?? "");
  });
});
