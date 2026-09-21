/**
 * The load cursor, and the guard that keeps it moving one way.
 *
 * Both sides of it are here: a cursor that never advanced would be satisfied by a statement
 * that ignored every write, and a cursor that can be rewound re-reads observations already
 * projected -- or, once two loaders overlap, skips rows that were never projected at all.
 */

import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { readCursor, writeCursor } from "./rawRecords.ts";

const IDENTITY = { source: "demo", tenantId: "CASE-0042", entity: "things" } as const;

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
