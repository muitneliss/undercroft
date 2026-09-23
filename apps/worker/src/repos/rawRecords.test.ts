/**
 * The load cursor, and the guard that keeps it moving one way.
 *
 * Both sides of it are here: a cursor that never advanced would be satisfied by a statement
 * that ignored every write, and a cursor that can be rewound re-reads observations already
 * projected -- or, once two loaders overlap, skips rows that were never projected at all.
 *
 * And the harvest mark, at the one thing the collector suites cannot see: which tenant's copy
 * of a record a mark answers for.
 */

import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { knownRecords, markHarvested, readCursor, writeCursor } from "./rawRecords.ts";

const IDENTITY = { source: "demo", tenantId: "CASE-0042", entity: "things" } as const;
/** The same provider id, held by a second customer. Providers do not coordinate their ids. */
const NEIGHBOUR = { ...IDENTITY, tenantId: "CASE-0043" } as const;

const EARLIER = "20260921T090000.000000Z";
const LATER = "20260921T120000.000000Z";

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  // Every statement runs as the worker does, so a missing grant fails here and not at 02:00.
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

describe("writeCursor", () => {
  it("a later stamp moves the cursor forward", async () => {
    await writeCursor(db, IDENTITY, EARLIER);

    await writeCursor(db, IDENTITY, LATER);

    expect(await readCursor(db, IDENTITY)).toBe(LATER);
  });

  it("an earlier stamp does not rewind it", async () => {
    // The loader writes the cursor after every batch, so two passes over one stream overlap
    // by construction -- a scheduled run and the recovery pass at the start of the next
    // entity. The slower one finishing second must not drag the cursor back behind rows that
    // are already in `raw.records`, or the observations between the two would be read again
    // for ever. The statement refuses it, so it holds for every caller and not just this one.
    await writeCursor(db, IDENTITY, LATER);

    await writeCursor(db, IDENTITY, EARLIER);

    expect(await readCursor(db, IDENTITY)).toBe(LATER);
  });
});

describe("markHarvested", () => {
  beforeEach(async () => {
    // Planted as the superuser: a partition and a second customer's row are the shape of the
    // table, not something the worker creates. Everything under test still runs as the worker.
    await db.asSuperuser(async (tx) => {
      await tx.query("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
      await tx.query(
        "CREATE TABLE raw.records_demo PARTITION OF raw.records FOR VALUES IN ('demo')",
      );
      await tx.query(
        `INSERT INTO raw.records (source, tenant_id, entity, source_record_id, payload,
           content_sha256, observed_at, lake_key, lake_stamp, run_id)
         VALUES ('demo', 'CASE-0042', 'things', '1', '{"n":1}'::jsonb, repeat('0', 64), now(), 'k', 's', 'r'),
                ('demo', 'CASE-0043', 'things', '1', '{"n":1}'::jsonb, repeat('0', 64), now(), 'k', 's', 'r')`,
      );
    });
  });

  it("a mark answers for one tenant's copy of a record and for nobody else's", async () => {
    // Two customers, one provider id -- which is the ordinary case, because a Gmail message id
    // and a Drive file id are the provider's and nothing about them is scoped to us. A
    // statement keyed on `source_record_id` alone would declare CASE-0043's copy fully
    // harvested on the strength of work done for CASE-0042, and CASE-0043's attachments would
    // then be skipped by every run and never fetched. That is the outage this column exists to
    // end, re-created by its repair, and no linter can see it.
    await markHarvested(db, IDENTITY, [{ sourceRecordId: "1", documentsLanded: 2 }]);

    const { rows } = await db.query<{ tenant_id: string; landed: string | null }>(
      `SELECT tenant_id, documents_landed::text AS landed
         FROM raw.records WHERE source = 'demo' ORDER BY tenant_id`,
    );
    expect(rows).toEqual([
      { tenant_id: "CASE-0042", landed: "2" },
      { tenant_id: "CASE-0043", landed: null },
    ]);
  });

  it("and only a marked record counts as held, which is what a collector skips on", async () => {
    // The two halves of the guard, as the caller sees them. Unmarked is the state every row
    // written before ADR 0035 is in, and it must read as "not held" or the repair never
    // starts; marked must read as "held" or it never ends.
    const probe = [{ sourceRecordId: "1", sourceUpdatedAt: null }];

    expect([...(await knownRecords(db, IDENTITY, probe))]).toEqual([]);

    await markHarvested(db, IDENTITY, [{ sourceRecordId: "1", documentsLanded: 0 }]);

    expect([...(await knownRecords(db, IDENTITY, probe))]).toEqual(["1"]);
    // A mark of ZERO is a complete harvest, not an absent one: a record whose only document
    // was refused for its declared size settles nothing and must still be held.
    expect([...(await knownRecords(db, NEIGHBOUR, probe))]).toEqual([]);
  });
});
