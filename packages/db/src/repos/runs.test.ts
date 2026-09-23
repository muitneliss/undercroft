/**
 * The run ledger's promises: one run at a time per pair, nothing lost on failure, pages
 * that do not skip or repeat, and an external caller's id kept to its own tenant.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { createMigratedTestDatabase, type TestDatabase } from "../testing.ts";
import {
  claimExternalRun,
  claimFailedRuns,
  closeAbandoned,
  closeRun,
  entitiesForRuns,
  eventsFor,
  findChildRun,
  getRun,
  listRuns,
  openRun,
  recordEntities,
  recordEvents,
  recordExternalBatch,
  pruneRefusals,
  reasonsFor,
  recordRefusalReasons,
  recordRefusals,
  refusalsFor,
} from "./runs.ts";

let db: TestDatabase;

const PAIR = {
  tenantId: "CASE-0042",
  source: "hubspot",
  verb: "ingest",
  trigger: "schedule",
} as const;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
  // The worker writes the ledger; every statement below runs with its grants and no more.
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

describe("one run at a time per (tenant, source, verb)", () => {
  it("a second run is refused by the database and names the one in progress", async () => {
    expect(await openRun(db, { id: "r1", ...PAIR })).toEqual({ ok: true });
    expect(await openRun(db, { id: "r2", ...PAIR })).toEqual({
      ok: false,
      reason: "in-progress",
      runId: "r1",
    });
  });

  it("a different source, or the same pair once the first has closed, is not refused", async () => {
    await openRun(db, { id: "r1", ...PAIR });
    expect(await openRun(db, { id: "r2", ...PAIR, source: "xero" })).toEqual({ ok: true });
    await closeRun(db, "r1", { status: "ok" });
    expect(await openRun(db, { id: "r3", ...PAIR })).toEqual({ ok: true });
  });
});

describe("what a closed run keeps", () => {
  it("its counts per entity, each refusal with its reason, and the fault cut to 500 characters", async () => {
    await openRun(db, { id: "r1", ...PAIR, triggeredBy: "6d2b1d9c-0000-4000-8000-000000000001" });
    await recordEntities(db, "r1", [
      { entity: "deals", landed: 3, created: 2, changed: 1, unchanged: 0, refused: 1 },
    ]);
    await recordRefusals(db, "r1", [
      { entity: "deals", sourceRecordId: "d-9", reason: "no value at idPath" },
    ]);
    await closeRun(db, "r1", {
      status: "failed",
      created: 2,
      changed: 1,
      refused: 1,
      error: "x".repeat(700),
    });

    const run = await getRun(db, "CASE-0042", "r1");
    expect(run?.status).toBe("failed");
    expect(run?.created).toBe(2);
    expect(run?.refused).toBe(1);
    expect(run?.error?.length).toBe(500);
    expect(run?.endedAt).not.toBeNull();
    expect(run?.triggeredBy).toBe("6d2b1d9c-0000-4000-8000-000000000001");

    const refusals = await refusalsFor(db, "r1");
    expect(refusals.map((r) => [r.entity, r.sourceRecordId, r.reason])).toEqual([
      ["deals", "d-9", "no value at idPath"],
    ]);
    const entities = await entitiesForRuns(db, ["r1"]);
    expect(entities.get("r1")?.[0]?.landed).toBe(3);
  });

  it("recording the same entity twice adds rather than replaces, so a resumed count is not lost", async () => {
    await openRun(db, { id: "r1", ...PAIR });
    await recordEntities(db, "r1", [
      { entity: "deals", landed: 1, created: 1, changed: 0, unchanged: 0, refused: 0 },
    ]);
    await recordEntities(db, "r1", [
      { entity: "deals", landed: 2, created: 0, changed: 2, unchanged: 0, refused: 0 },
    ]);
    expect((await entitiesForRuns(db, ["r1"])).get("r1")?.[0]).toEqual({
      entity: "deals",
      landed: 3,
      created: 1,
      changed: 2,
      unchanged: 0,
      refused: 0,
    });
  });

  it("a run of another tenant is not found through this tenant", async () => {
    await openRun(db, { id: "r1", ...PAIR });
    expect(await getRun(db, "CASE-0043", "r1")).toBeNull();
  });
});

describe("a run's chained child", () => {
  it("is found by the parent's id, once it exists", async () => {
    await openRun(db, { id: "r1", ...PAIR });
    expect(await findChildRun(db, "CASE-0042", "r1")).toBeNull();

    await closeRun(db, "r1", { status: "ok" });
    await openRun(db, { id: "r2", ...PAIR, verb: "transform", source: "*", parentRunId: "r1" });

    const child = await findChildRun(db, "CASE-0042", "r1");
    expect(child?.id).toBe("r2");
    expect(child?.parentRunId).toBe("r1");
  });

  it("is not found through another tenant, or for a run nothing chained from", async () => {
    await openRun(db, { id: "r1", ...PAIR });
    await closeRun(db, "r1", { status: "ok" });
    await openRun(db, { id: "r2", ...PAIR, verb: "transform", source: "*", parentRunId: "r1" });

    expect(await findChildRun(db, "CASE-0043", "r1")).toBeNull();
    expect(await findChildRun(db, "CASE-0042", "r2")).toBeNull();
  });
});

describe("what a run says while it is still running", () => {
  it("its events come back in the order they happened, with the counts they carried", async () => {
    await openRun(db, { id: "r1", ...PAIR });
    await recordEvents(db, "r1", [
      {
        at: "2026-09-19T12:42:22.000Z",
        level: "info",
        event: "work_listed",
        entity: "messages",
        detail: { total: 12_431 },
        live: false,
      },
      {
        at: "2026-09-19T12:44:10.000Z",
        level: "info",
        event: "records_read",
        entity: "messages",
        detail: { read: 840, total: 12_431 },
        live: true,
      },
    ]);

    const events = await eventsFor(db, "r1");
    expect(events.map((e) => e.event)).toEqual(["work_listed", "records_read"]);
    expect(events[0]?.at).toBe("2026-09-19T12:42:22.000Z");
    expect(events[1]?.detail).toEqual({ read: 840, total: 12_431 });
    expect(events[1]?.entity).toBe("messages");
  });

  it("past the read limit it answers with the newest, still oldest-first", async () => {
    await openRun(db, { id: "r1", ...PAIR });
    await recordEvents(
      db,
      "r1",
      [1, 2, 3, 4].map((n) => ({
        at: `2026-09-19T12:0${String(n)}:00.000Z`,
        level: "info" as const,
        event: "records_read",
        entity: "messages",
        detail: { read: n },
        live: false,
      })),
    );

    expect((await eventsFor(db, "r1", 2)).map((e) => e.detail.read)).toEqual([3, 4]);
  });

  it("a gauge's second reading replaces the first in the place it first appeared, so the ledger does not reshuffle under a reader", async () => {
    await openRun(db, { id: "r1", ...PAIR });
    const gauge = {
      at: "2026-09-19T12:00:00.000Z",
      level: "info" as const,
      event: "records_read",
      entity: "messages",
      detail: { read: 5 },
      live: true,
    };
    await recordEvents(db, "r1", [gauge]);
    await recordEvents(db, "r1", [
      {
        at: "2026-09-19T12:01:00.000Z",
        level: "info",
        event: "entity_done",
        entity: "messages",
        detail: { landed: 5 },
        live: false,
      },
    ]);
    await recordEvents(db, "r1", [
      { ...gauge, at: "2026-09-19T12:02:00.000Z", detail: { read: 9 } },
    ]);

    const events = await eventsFor(db, "r1");
    expect(events.map((e) => e.event)).toEqual(["records_read", "entity_done"]);
    expect(events[0]?.detail).toEqual({ read: 9 });
    expect(events[0]?.live).toBe(true);
  });

  it("two readings in one flush write the last one, which is the only one still true", async () => {
    await openRun(db, { id: "r1", ...PAIR });
    await recordEvents(
      db,
      "r1",
      [11, 22, 33].map((read) => ({
        at: "2026-09-19T12:00:00.000Z",
        level: "info" as const,
        event: "records_read",
        entity: "messages",
        detail: { read },
        live: true,
      })),
    );

    const events = await eventsFor(db, "r1");
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toEqual({ read: 33 });
  });

  it("two entities read at once keep one gauge each", async () => {
    await openRun(db, { id: "r1", ...PAIR });
    await recordEvents(db, "r1", [
      {
        at: "2026-09-19T12:00:00.000Z",
        level: "info",
        event: "records_read",
        entity: "messages",
        detail: { read: 4 },
        live: true,
      },
      {
        at: "2026-09-19T12:00:00.000Z",
        level: "info",
        event: "records_read",
        entity: "files",
        detail: { read: 7 },
        live: true,
      },
    ]);

    expect((await eventsFor(db, "r1")).map((e) => e.entity)).toEqual(["messages", "files"]);
  });

  it("a run with no events has an empty feed rather than a refusal", async () => {
    await openRun(db, { id: "r1", ...PAIR });
    expect(await eventsFor(db, "r1")).toEqual([]);
  });

  it("the feed goes when the run goes: it is evidence about a run, not an archive", async () => {
    await openRun(db, { id: "r1", ...PAIR });
    await recordEvents(db, "r1", [
      {
        at: "2026-09-19T12:00:00.000Z",
        level: "warn",
        event: "no_models",
        entity: null,
        detail: {},
        live: false,
      },
    ]);
    await db.asSuperuser((tx) => tx.exec("DELETE FROM ops.run WHERE id = 'r1'"));

    expect(await eventsFor(db, "r1")).toEqual([]);
  });
});

describe("the ledger pages newest first", () => {
  it("with an opaque cursor that neither skips nor repeats a run", async () => {
    for (const id of ["r1", "r2", "r3"]) {
      await openRun(db, { id, ...PAIR });
      await closeRun(db, id, { status: "ok" });
    }
    // Spread the start instants so the order is a fact and not an accident of one millisecond.
    await db.asSuperuser((tx) =>
      tx.exec(
        `UPDATE ops.run SET started_at = '2026-09-19T01:00:00Z' WHERE id = 'r1';
         UPDATE ops.run SET started_at = '2026-09-19T02:00:00Z' WHERE id = 'r2';
         UPDATE ops.run SET started_at = '2026-09-19T03:00:00Z' WHERE id = 'r3'`,
      ),
    );

    const first = await listRuns(db, "CASE-0042", { limit: 2 });
    expect(first.items.map((r) => r.id)).toEqual(["r3", "r2"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await listRuns(db, "CASE-0042", { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((r) => r.id)).toEqual(["r1"]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("the ledger survives the process", () => {
  it("a run left running by a restart is closed as failed with the reason, and the pair is free again", async () => {
    await openRun(db, { id: "r1", ...PAIR });
    expect(await closeAbandoned(db, "the worker restarted")).toEqual(["r1"]);
    const run = await getRun(db, "CASE-0042", "r1");
    expect(run?.status).toBe("failed");
    expect(run?.error).toBe("the worker restarted");
    expect(await openRun(db, { id: "r2", ...PAIR })).toEqual({ ok: true });
  });

  it("with nothing running, closing abandoned runs closes nothing", async () => {
    await openRun(db, { id: "r1", ...PAIR });
    await closeRun(db, "r1", { status: "ok" });
    expect(await closeAbandoned(db, "the worker restarted")).toEqual([]);
    expect((await getRun(db, "CASE-0042", "r1"))?.status).toBe("ok");
  });
});

describe("an external caller's run id", () => {
  it("is claimed once, accumulates its batches, and follows its worst batch", async () => {
    expect(await claimExternalRun(db, { id: "ext-1", tenantId: "CASE-0042", source: "csv" })).toBe(
      true,
    );
    await recordExternalBatch(db, "ext-1", { created: 2, unchanged: 0, refused: 0 });
    expect(await claimExternalRun(db, { id: "ext-1", tenantId: "CASE-0042", source: "csv" })).toBe(
      true,
    );
    await recordExternalBatch(db, "ext-1", { created: 1, unchanged: 1, refused: 1 });

    const run = await getRun(db, "CASE-0042", "ext-1");
    expect(run?.trigger).toBe("lake-api");
    expect(run?.created).toBe(3);
    expect(run?.unchanged).toBe(1);
    expect(run?.refused).toBe(1);
    expect(run?.status).toBe("failed");
  });

  it("is refused for another tenant, so a shared id cannot merge two customers' runs", async () => {
    await claimExternalRun(db, { id: "ext-1", tenantId: "CASE-0042", source: "csv" });
    expect(await claimExternalRun(db, { id: "ext-1", tenantId: "CASE-0043", source: "csv" })).toBe(
      false,
    );
    expect(await getRun(db, "CASE-0043", "ext-1")).toBeNull();
  });
});

describe("a failure is claimed for notice once", () => {
  async function failed(id: string, source = "hubspot"): Promise<void> {
    await openRun(db, { id, ...PAIR, source });
    await closeRun(db, id, { status: "failed", error: "answered 401" });
  }

  it("the first failure is sent; the same failure is never claimed twice", async () => {
    await failed("f1");
    expect((await claimFailedRuns(db)).map((r) => [r.id, r.notice])).toEqual([["f1", "sent"]]);
    expect(await claimFailedRuns(db)).toEqual([]);
  });

  it("a second failure of the pair within a day is suppressed; another pair is not", async () => {
    await failed("f1");
    await claimFailedRuns(db);
    await failed("f2");
    await failed("x1", "xero");

    const claimed = await claimFailedRuns(db);
    expect(claimed.map((r) => [r.id, r.notice])).toEqual([
      ["f2", "suppressed"],
      ["x1", "sent"],
    ]);
  });

  it("a success in between, or a notice older than a day, lets the next failure through", async () => {
    await failed("f1");
    await claimFailedRuns(db);
    await openRun(db, { id: "ok", ...PAIR });
    await closeRun(db, "ok", { status: "ok" });
    await failed("f2");
    expect((await claimFailedRuns(db)).map((r) => r.notice)).toEqual(["sent"]);

    // The quiet side of the window: a notice sent yesterday no longer holds today's.
    await db.asSuperuser((tx) =>
      tx.exec("UPDATE ops.run SET notified_at = now() - interval '25 hours' WHERE id = 'f2'"),
    );
    await failed("f3");
    expect((await claimFailedRuns(db)).map((r) => r.notice)).toEqual(["sent"]);
  });

  it("a failure older than a day is left alone rather than reported late", async () => {
    await failed("old");
    await db.asSuperuser((tx) =>
      tx.exec("UPDATE ops.run SET ended_at = now() - interval '2 days' WHERE id = 'old'"),
    );
    expect(await claimFailedRuns(db)).toEqual([]);
  });
});

/**
 * The split that keeps retention from reintroducing the defect it lives inside a fix for.
 *
 * Prune the per-record rows alone and a month-old run prints `refused: 245` over an empty
 * table -- which is indistinguishable from the bug where the verb recorded nothing at all.
 * The rollup is what stops that, so "it survives" is the promise, not an implementation
 * detail. ADR 0039.
 */
describe("refusal retention", () => {
  async function runThatRefused(id: string): Promise<void> {
    await openRun(db, { id, ...PAIR });
    await recordRefusals(db, id, [
      { entity: "documents", sourceRecordId: "d1", reason: "image-too-small-to-read" },
      { entity: "documents", sourceRecordId: "d2", reason: "image-too-small-to-read" },
    ]);
    await recordRefusalReasons(db, id, [
      { entity: "documents", reason: "image-too-small-to-read", count: 2 },
    ]);
    await closeRun(db, id, { status: "ok", refused: 2 });
  }

  it("drops the per-record rows past the window, and keeps the rollup that explains them", async () => {
    await runThatRefused("r-old");
    await db.asSuperuser((tx) =>
      tx.exec("UPDATE ops.run_refusal SET at = now() - interval '30 days'"),
    );

    expect(await pruneRefusals(db, 7)).toBe(2);
    expect(await refusalsFor(db, "r-old")).toEqual([]);
    // The rollup survives, so the run's refused count still has an answer.
    expect(await reasonsFor(db, "r-old")).toEqual([
      { entity: "documents", reason: "image-too-small-to-read", count: 2 },
    ]);
  });

  it("leaves a refusal inside the window alone", async () => {
    // The quiet half of the guard: a prune that removed everything would pass the test above
    // and lose a week of detail in production.
    await runThatRefused("r-fresh");

    expect(await pruneRefusals(db, 7)).toBe(0);
    expect(await refusalsFor(db, "r-fresh")).toHaveLength(2);
  });

  it("counts a reason once per run, however many batches recorded it", async () => {
    // Summed on conflict, like `recordEntities`: a verb that records in batches adds to its
    // own tally rather than overwriting the half already counted.
    await openRun(db, { id: "r-batched", ...PAIR });
    await recordRefusalReasons(db, "r-batched", [
      { entity: "documents", reason: "ocr-found-nothing", count: 3 },
    ]);
    await recordRefusalReasons(db, "r-batched", [
      { entity: "documents", reason: "ocr-found-nothing", count: 4 },
    ]);

    expect(await reasonsFor(db, "r-batched")).toEqual([
      { entity: "documents", reason: "ocr-found-nothing", count: 7 },
    ]);
  });
});

describe("a run says which build produced it", () => {
  it("keeps the stamp it was opened with", async () => {
    // Stamped at open rather than at close, so it is true even of a run that failed -- which
    // is the run whose build a reader most wants to know. ADR 0039.
    await openRun(db, { id: "r-stamped", ...PAIR, releaseTag: "v1.16.0" });
    expect((await getRun(db, PAIR.tenantId, "r-stamped"))?.releaseTag).toBe("v1.16.0");
  });

  it("records a blank when the image did not say, rather than a guess", async () => {
    await openRun(db, { id: "r-blank", ...PAIR });
    expect((await getRun(db, PAIR.tenantId, "r-blank"))?.releaseTag).toBe("");
  });
});
