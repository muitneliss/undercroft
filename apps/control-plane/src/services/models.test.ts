/**
 * What the models service promises: a save stores SQL and tests and executes nothing, a
 * create refuses a name already in use without touching the row, the list carries each
 * model's last build from the ledger, one tenant's models are never another's, and the
 * trail names the model and never its SQL.
 *
 * Runs as `undercroft_app`, so a missing grant on `app.model` fails here.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { migrate } from "@undercroft/db";
import { closeRun, openRun, recordSteps } from "@undercroft/db/repos";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { get, list, remove, save } from "./models.ts";

const TENANT = "CASE-0042";
const OTHER = "CASE-0043";
const ACTOR = { actor: "ada@example.test", actorId: "u-ada" };
const SQL = "select source_record_id as deal_id from {{ source('undercroft', 'records') }}";

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1), ($2)", [TENANT, OTHER]);
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("save", () => {
  it("stores the SQL and the tests, and creates no relation anywhere", async () => {
    const outcome = await save(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "stg_deals",
      sql: SQL,
      tests: { columns: { deal_id: ["not_null", "unique"] } },
      create: true,
    });
    expect(outcome).toEqual({ ok: true });

    const model = await get(db, TENANT, "stg_deals");
    expect(model?.sql).toBe(SQL);
    expect(model?.tests).toEqual({ columns: { deal_id: ["not_null", "unique"] } });
    expect(model?.updatedBy).toBe("u-ada");
    expect(model?.lastBuild).toBeNull();

    // Save executes nothing: no relation named for the model exists in any schema.
    const { rows } = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_class WHERE relname = 'stg_deals'",
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("creating over an existing name is refused and leaves the existing SQL alone", async () => {
    await save(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "stg_deals",
      sql: SQL,
      tests: { columns: {} },
      create: true,
    });

    const outcome = await save(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "stg_deals",
      sql: "select 1",
      tests: { columns: {} },
      create: true,
    });

    expect(outcome).toEqual({ ok: false, reason: "name-taken" });
    expect((await get(db, TENANT, "stg_deals"))?.sql).toBe(SQL);
  });

  it("saving without create overwrites, which is what Save on an open editor means", async () => {
    await save(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "stg_deals",
      sql: SQL,
      tests: { columns: {} },
      create: true,
    });
    await save(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "stg_deals",
      sql: "select 2",
      tests: { columns: {} },
      create: false,
    });
    expect((await get(db, TENANT, "stg_deals"))?.sql).toBe("select 2");
  });

  it("the trail names the model and who saved it, never the SQL", async () => {
    await save(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "stg_deals",
      sql: SQL,
      tests: { columns: {} },
      create: true,
    });

    const { rows } = await db.query<{ action: string; detail: string; actor: string }>(
      "SELECT action, detail::text AS detail, actor FROM ops.audit_log WHERE tenant_id = $1",
      [TENANT],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("models.save");
    expect(rows[0]?.actor).toBe("ada@example.test");
    expect(rows[0]?.detail).toContain("stg_deals");
    expect(rows[0]?.detail).not.toContain("select");
  });
});

describe("list", () => {
  it("names each model with its newest build from the ledger, and only this tenant's", async () => {
    await save(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "stg_deals",
      sql: SQL,
      tests: { columns: {} },
      create: true,
    });
    await save(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "stg_contacts",
      sql: SQL,
      tests: { columns: {} },
      create: true,
    });
    await save(db, {
      ...ACTOR,
      tenantId: OTHER,
      name: "stg_theirs",
      sql: SQL,
      tests: { columns: {} },
      create: true,
    });

    // Two builds of stg_deals; the newer one failed. The ledger is the worker's to write,
    // so the fixture writes it as the worker would.
    await db.asSuperuser(async (tx) => {
      await openRun(tx, {
        id: "t-1",
        tenantId: TENANT,
        source: "*",
        verb: "transform",
        trigger: "schedule",
      });
      await recordSteps(tx, "t-1", [
        {
          uniqueId: "model.t.stg_deals",
          kind: "model",
          name: "stg_deals",
          status: "success",
          failures: null,
          relation: null,
          message: null,
          executionMs: 10,
        },
      ]);
      await closeRun(tx, "t-1", { status: "ok" });
      await openRun(tx, {
        id: "t-2",
        tenantId: TENANT,
        source: "*",
        verb: "transform",
        trigger: "build",
      });
      await recordSteps(tx, "t-2", [
        {
          uniqueId: "model.t.stg_deals",
          kind: "model",
          name: "stg_deals",
          status: "error",
          failures: null,
          relation: null,
          message: "boom",
          executionMs: 5,
        },
      ]);
      await closeRun(tx, "t-2", { status: "failed", error: "dbt build exited 1" });
    });

    const items = await list(db, TENANT);
    expect(items.map((m) => m.name)).toEqual(["stg_contacts", "stg_deals"]);
    expect(items[0]?.lastBuild).toBeNull();
    expect(items[1]?.lastBuild).toMatchObject({ runId: "t-2", status: "error", columns: [] });
    expect(items[1]?.lastBuild?.endedAt).not.toBeNull();
  });
});

describe("remove", () => {
  it("removes the model and says so; a second removal says there was nothing", async () => {
    await save(db, {
      ...ACTOR,
      tenantId: TENANT,
      name: "stg_deals",
      sql: SQL,
      tests: { columns: {} },
      create: true,
    });

    expect(await remove(db, { tenantId: TENANT, name: "stg_deals", actor: ACTOR.actor })).toBe(
      true,
    );
    expect(await get(db, TENANT, "stg_deals")).toBeNull();
    expect(await remove(db, { tenantId: TENANT, name: "stg_deals", actor: ACTOR.actor })).toBe(
      false,
    );
  });
});
