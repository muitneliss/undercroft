/**
 * What the Journal division may read: a run's feed while it is still running, and nothing of
 * a run belonging to somebody else.
 *
 * Runs as `undercroft_app`, so a missing grant on `ops.run_event` fails here rather than at
 * first use in production. The events themselves are planted as the superuser because the
 * control plane cannot write them -- only the worker can, which is the grant model working.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TestClock } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { events, get } from "./runs.ts";

const TENANT = "CASE-0042";
const OTHER = "CASE-0043";
/** A read that waits for nothing and lists the problem steps, as a call that names neither does. */
const READ = { steps: { stepLimit: 100 } };

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
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

    const parent = await get(db, TENANT, "run-mine", READ);
    expect(parent?.childRun).toMatchObject({ id: "run-child", kind: "transform", status: "ok" });

    const child = await get(db, TENANT, "run-child", READ);
    expect(child?.parentRun).toMatchObject({ id: "run-mine", kind: "ingest" });
  });

  it("is null on both sides of a run nothing has chained with", async () => {
    const detail = await get(db, TENANT, "run-mine", READ);
    expect(detail?.parentRun).toBeNull();
    expect(detail?.childRun).toBeNull();
  });
});

describe("what kind of run it was", () => {
  it("a text-reading run is an extract, not an ingest of the same source (#309)", async () => {
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO ops.run (id, tenant_id, source, verb, trigger)
         VALUES ('run-read', $1, 'gmail', 'extract', 'schedule')`,
        [TENANT],
      ),
    );

    expect((await get(db, TENANT, "run-read", READ))?.kind).toBe("extract");
    expect((await get(db, TENANT, "run-mine", READ))?.kind).toBe("ingest");
  });
});

describe("what a run counted", () => {
  it("a closed ingest reports the records it saw", async () => {
    await db.asSuperuser((tx) =>
      tx.query(
        `UPDATE ops.run SET status = 'ok', ended_at = now(), created = 4, changed = 1
         WHERE id = 'run-mine'`,
      ),
    );

    expect((await get(db, TENANT, "run-mine", READ))?.counts).toMatchObject({
      created: 4,
      changed: 1,
    });
  });

  it("a closed build reports none, because a build lands no record to count", async () => {
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO ops.run (id, tenant_id, source, verb, trigger, status, ended_at)
         VALUES ('run-built', $1, '*', 'transform', 'schedule', 'ok', now())`,
        [TENANT],
      ),
    );

    // Four zeroes on the row would say the build read nothing, of a run that was never going
    // to read anything. Nothing to count reads as MISSING, the same as not counted yet.
    expect((await get(db, TENANT, "run-built", READ))?.counts).toBeNull();
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
    expect((await get(db, TENANT, "run-mine", READ))?.counts).toBeNull();
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

/**
 * Three states that must not render alike: refused nothing, refused with the records still
 * here, and refused with the records aged out.
 *
 * The third showing an empty table is ADR 0039's defect wearing a hat -- a count with nothing
 * behind it -- so the difference is decided here, once, rather than left to the interface.
 */
describe("what a run says about the rows it refused", () => {
  async function refusedWithRollup(): Promise<void> {
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO ops.run_refusal_reason (run_id, entity, reason, count)
         VALUES ('run-mine', 'documents', 'image-too-small-to-read', 230)`,
      ),
    );
  }

  it("a run that refused nothing claims no pruning", async () => {
    expect(await get(db, TENANT, "run-mine", READ)).toMatchObject({
      reasonCounts: [],
      refusalsPruned: false,
    });
  });

  it("a run whose records are still here claims no pruning either", async () => {
    await refusedWithRollup();
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO ops.run_refusal (run_id, entity, source_record_id, reason)
         VALUES ('run-mine', 'documents', 'd1', 'image-too-small-to-read')`,
      ),
    );

    expect(await get(db, TENANT, "run-mine", READ)).toMatchObject({ refusalsPruned: false });
  });

  it("a run the rollup remembers but the records have left says the detail went", async () => {
    await refusedWithRollup();

    const detail = await get(db, TENANT, "run-mine", READ);

    expect(detail?.refusalsPruned).toBe(true);
    // And the count still has its answer, which is the whole reason the rollup is kept.
    expect(detail?.reasonCounts).toEqual([
      { entity: "documents", reason: "image-too-small-to-read", count: 230 },
    ]);
  });
});

/**
 * `get` with a wait (issue 440), on a clock only the test moves, so nothing here waits for real
 * and nothing passes by being fast. A wait is "parked" once it sleeps on that clock; the test
 * polls for that, changes the ledger, then moves time.
 */
describe("waiting for a run to settle", () => {
  let clock: TestClock;

  beforeEach(() => {
    // Aligned with the database's own `now()`, which stamps `ended_at` -- the chain grace is
    // measured between the two.
    clock = new TestClock(new Date());
  });

  /** Poll until the wait sleeps on the clock: it has read the run and found more to wait for. */
  async function parked(): Promise<void> {
    for (let tries = 0; tries < 2000 && clock.sleeping === 0; tries += 1) {
      await Bun.sleep(1);
    }
    expect(clock.sleeping).toBe(1);
  }

  async function close(
    runId: string,
    { status = "ok", endedAt = "now()" }: { status?: string; endedAt?: string } = {},
  ): Promise<void> {
    await db.asSuperuser((tx) =>
      tx.query(`UPDATE ops.run SET status = $2, ended_at = ${endedAt} WHERE id = $1`, [
        runId,
        status,
      ]),
    );
  }

  it("answers once the run closes, with the verdict the ledger then holds", async () => {
    const answer = get(db, TENANT, "run-mine", { ...READ, wait: { seconds: 50, clock } });
    await parked();

    // Failed, because a failed ingest chains nothing: the answer comes at the next read.
    await close("run-mine", { status: "failed" });
    await clock.advance(1000);

    expect((await answer)?.status).toBe("failed");
  });

  it("answers `running` when the wait runs out, and claims nothing it did not see", async () => {
    const answer = get(db, TENANT, "run-mine", { ...READ, wait: { seconds: 3, clock } });
    for (let second = 0; second < 3; second += 1) {
      await parked();
      await clock.advance(1000);
    }

    const run = await answer;
    expect(run?.status).toBe("running");
    expect(run?.endedAt).toBeNull();
    expect(run?.counts).toBeNull();
  });

  it("stops when its request is gone, without the clock moving", async () => {
    const hangUp = new AbortController();
    const answer = get(db, TENANT, "run-mine", {
      ...READ,
      wait: { seconds: 50, clock, signal: hangUp.signal },
    });
    await parked();

    hangUp.abort();

    expect((await answer)?.status).toBe("running");
  });

  it("after an ingest closes ok, waits for the transform it chains, so `childRun` is not null too early", async () => {
    await close("run-mine");
    const answer = get(db, TENANT, "run-mine", { ...READ, wait: { seconds: 50, clock } });
    await parked();

    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO ops.run (id, tenant_id, source, verb, trigger, parent_run_id)
         VALUES ('run-built', $1, '*', 'transform', 'manual', 'run-mine')`,
        [TENANT],
      ),
    );
    await clock.advance(1000);

    expect((await answer)?.childRun).toMatchObject({ id: "run-built", status: "running" });
  });

  it("an ingest that closed long ago has nothing left to chain, and is answered at once", async () => {
    await close("run-mine", { endedAt: "now() - interval '1 hour'" });

    // No `advance`: a wait that parked here would never be answered, and the test would time out.
    const run = await get(db, TENANT, "run-mine", { ...READ, wait: { seconds: 50, clock } });

    expect(run?.status).toBe("ok");
    expect(run?.childRun).toBeNull();
  });

  it("a run that is not this tenant's is nothing, at once, waited for or not", async () => {
    expect(
      await get(db, TENANT, "run-theirs", { ...READ, wait: { seconds: 50, clock } }),
    ).toBeNull();
  });
});

describe("a run's steps", () => {
  it("are summarised in full and listed as asked, the problems by default", async () => {
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO ops.run_step (run_id, unique_id, kind, name, status) VALUES
           ('run-mine', 'model.shop.orders', 'model', 'orders', 'success'),
           ('run-mine', 'test.shop.unique_orders_id', 'test', 'unique_orders_id', 'pass'),
           ('run-mine', 'test.shop.not_null_orders_total', 'test', 'not_null_orders_total', 'fail')`,
      ),
    );

    const detail = await get(db, TENANT, "run-mine", READ);

    expect(detail?.stepSummary).toEqual({
      total: 3,
      byStatus: { model: { success: 1 }, test: { pass: 1, fail: 1 } },
      problems: 1,
    });
    expect(detail?.steps.map((s) => s.name)).toEqual(["not_null_orders_total"]);
    expect(detail?.nextStepCursor).toBeNull();
  });
});
