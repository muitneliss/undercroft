/**
 * What the Journal division may read: a run's feed while it is still running, and nothing of
 * a run belonging to somebody else.
 *
 * Runs as `undercroft_app`, so a missing grant on `ops.run_event` fails here rather than at
 * first use in production. The events themselves are planted as the superuser because the
 * control plane cannot write them -- only the worker can, which is the grant model working.
 */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, run_id, started_at), a source API's payload keys, HTTP header names, and Better Auth's option keys. strictCase cannot be satisfied by code that talks to another system.

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { events, get } from "./runs.ts";

const TENANT = "CASE-0042";
const OTHER = "CASE-0043";

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1), ($2)", [TENANT, OTHER]);
  await db.query(
    `INSERT INTO ops.run (id, tenant_id, source, verb, trigger)
     VALUES ('run-mine', $1, 'gmail', 'ingest', 'manual'),
            ('run-theirs', $2, 'gmail', 'ingest', 'manual')`,
    [TENANT, OTHER],
  );
  await db.query(
    `INSERT INTO ops.run_event (run_id, at, level, event, entity, detail) VALUES
       ('run-mine', '2026-09-19T12:42:22Z', 'info', 'run_opened', NULL, '{}'::jsonb),
       ('run-mine', '2026-09-19T12:42:24Z', 'info', 'work_listed', 'messages',
        '{"total": 12431}'::jsonb),
       ('run-theirs', '2026-09-19T12:42:30Z', 'info', 'run_opened', NULL, '{}'::jsonb)`,
  );
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("a run's place in its chain", () => {
  it("names the run it chained into and the run it chained from, once both exist", async () => {
    await db.query(
      `INSERT INTO ops.run (id, tenant_id, source, verb, trigger, parent_run_id, status)
       VALUES ('run-child', $1, '*', 'transform', 'schedule', 'run-mine', 'ok')`,
      [TENANT],
    );

    const parent = await get(db, TENANT, "run-mine");
    expect(parent?.childRun).toMatchObject({ id: "run-child", kind: "transform", status: "ok" });

    const child = await get(db, TENANT, "run-child");
    expect(child?.parentRun).toMatchObject({ id: "run-mine", kind: "ingest" });
  });

  it("is null on both sides of a run nothing has chained with", async () => {
    const detail = await get(db, TENANT, "run-mine");
    expect(detail?.parentRun).toBeNull();
    expect(detail?.childRun).toBeNull();
  });
});

describe("a run's feed", () => {
  it("comes back oldest first, with what each line counted", async () => {
    const feed = await events(db, TENANT, "run-mine");

    expect(feed?.map((e) => e.event)).toEqual(["run_opened", "work_listed"]);
    expect(feed?.[1]).toMatchObject({ entity: "messages", detail: { total: 12_431 } });
  });

  it("a run still running has one, which is the whole point of reading it separately", async () => {
    // `get` answers `counts: null` while a run is in progress -- a count that is still
    // changing is not a count -- so the feed is the only thing the screen can show.
    expect((await get(db, TENANT, "run-mine"))?.counts).toBeNull();
    expect(await events(db, TENANT, "run-mine")).not.toHaveLength(0);
  });

  it("another tenant's run is nothing, not an empty feed", async () => {
    expect(await events(db, TENANT, "run-theirs")).toBeNull();
  });

  it("a run of one's own that has said nothing yet is an empty feed, not nothing", async () => {
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO ops.run (id, tenant_id, source, verb, trigger)
         VALUES ('run-quiet', $1, 'xero', 'ingest', 'schedule')`,
        [TENANT],
      ),
    );

    expect(await events(db, TENANT, "run-quiet")).toEqual([]);
  });
});
