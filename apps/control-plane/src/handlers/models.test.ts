/**
 * Models over tRPC: who may write one, and what a taken name is told.
 *
 * The role gate is pinned from both sides -- a member is refused, an admin is answered --
 * and the worded refusals on this router arrive in the caller's language: a name already in
 * use, and a delete that did not happen because what the model built could not be dropped.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { InMemoryWorkerClient } from "../services/inMemoryWorkerClient.ts";
import type { WorkerClient } from "../services/workerClient.ts";
import { appRouter } from "./router.ts";
import { type Context, type Role, refusalFacts } from "./trpc.ts";

const TENANT = "CASE-0042";

let db: TestDatabase;

async function seedMember(email: string, role: Role): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [email],
  );
  const userId = rows[0]?.id ?? "";
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    TENANT,
    userId,
    role,
  ]);
  return userId;
}

function caller(
  userId: string,
  email: string,
  locale: "vi" | "en" = "vi",
  {
    worker = null,
    grant = "write",
  }: { worker?: WorkerClient | null; grant?: Context["grant"] } = {},
) {
  const ctx: Context = {
    exec: db,
    user: { userId, email },
    credentialId: "s1",
    via: "session",
    grant,
    superadmin: false,
    locale,
    endSession: () => Promise.resolve(),
    apps: null,
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () =>
      Promise.resolve({
        ok: false as const,
        reason: "not-configured" as const,
        provider: "google" as const,
      }),
    worker,
    specReads: new Map(),
    googlePicker: null,
    signInMethods: [],
    channel: "web",
    publicUrl: null,
    holdOpen: () => undefined,
  };
  return appRouter.createCaller(ctx);
}

async function refusal(fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof TRPCError) {
      return { code: error.code, message: error.message };
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

const DRAFT = { tenantId: TENANT, name: "stg_deals", sql: "select 1", tests: { columns: {} } };

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("models.save", () => {
  it("a member is refused: what a dashboard shows is an admin's decision", async () => {
    const member = await seedMember("m@example.test", "member");
    const got = await refusal(() => caller(member, "m@example.test").models.save(DRAFT));
    expect(got.code).toBe("FORBIDDEN");
  });

  it("an admin saves, and any member then reads it back", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const viewer = await seedMember("v@example.test", "viewer");

    await caller(admin, "a@example.test").models.save({ ...DRAFT, create: true });

    const listed = await caller(viewer, "v@example.test").models.list({ tenantId: TENANT });
    expect(listed.map((m) => m.name)).toEqual(["stg_deals"]);
    const full = await caller(viewer, "v@example.test").models.get({
      tenantId: TENANT,
      name: "stg_deals",
    });
    expect(full.sql).toBe("select 1");
  });

  it("a taken name is a CONFLICT worded in the caller's language", async () => {
    const admin = await seedMember("a@example.test", "admin");
    await caller(admin, "a@example.test").models.save({ ...DRAFT, create: true });

    const got = await refusal(() =>
      caller(admin, "a@example.test", "en").models.save({ ...DRAFT, create: true }),
    );
    expect(got.code).toBe("CONFLICT");
    expect(got.message).toBe(
      "A model named stg_deals already exists. Open it to edit, or choose another name.",
    );
  });

  it("a name that is not a plain identifier is refused before it reaches the database", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const got = await refusal(() =>
      caller(admin, "a@example.test").models.save({ ...DRAFT, name: "Deals-2026" }),
    );
    expect(got.code).toBe("BAD_REQUEST");
  });
});

describe("models.build", () => {
  /** An admin, and the customer's models these tests build, saved the way an admin saves them. */
  async function adminWithModels(...names: string[]): Promise<string> {
    const admin = await seedMember("a@example.test", "admin");
    for (const name of names) {
      await caller(admin, "a@example.test").models.save({ ...DRAFT, name, create: true });
    }
    return admin;
  }

  /** The refusal's code, sentence and facts, as an agent at either door receives them. */
  async function refusedWith(
    fn: () => Promise<unknown>,
  ): Promise<{ code: string; message: string; facts: unknown }> {
    try {
      await fn();
    } catch (error) {
      if (error instanceof TRPCError) {
        return { code: error.code, message: error.message, facts: refusalFacts(error) };
      }
      throw error;
    }
    throw new Error("expected a refusal");
  }

  async function buildTrail(): Promise<{ outcome: string; detail: unknown }[]> {
    const { rows } = await db.query<{ outcome: string; detail: unknown }>(
      `SELECT outcome, detail FROM ops.audit_log
       WHERE tenant_id = $1 AND action = 'models.build' ORDER BY id`,
      [TENANT],
    );
    return rows;
  }

  it("a member is refused; an admin's build of several models is ONE selection, on the trail", async () => {
    const member = await seedMember("m@example.test", "member");
    const admin = await adminWithModels("stg_deals", "fct_pipeline", "dim_owner");
    const worker = new InMemoryWorkerClient();
    const names = ["stg_deals", "+fct_pipeline", "dim_owner+"];

    const got = await refusal(() =>
      caller(member, "m@example.test", "vi", { worker }).models.build({ tenantId: TENANT, names }),
    );
    expect(got.code).toBe("FORBIDDEN");

    const built = await caller(admin, "a@example.test", "vi", { worker }).models.build({
      tenantId: TENANT,
      names,
    });
    expect(built.waited && built.ok).toBe(true);
    // Issue 442: three models were three calls, each taking the tenant's build lock in turn.
    expect(worker.builds.asked).toEqual([
      { tenantId: TENANT, select: names, wait: true, triggeredBy: admin },
    ]);
    const trail = await buildTrail();
    expect(trail.map((row) => row.outcome)).toEqual(["refused", "ok"]);
    // The selection and the run, never SQL.
    expect(trail[1]?.detail).toEqual({ names, runId: built.runId, waited: true, ok: true });
  });

  it("`name` alone still builds its one model, as every caller before `names` sends it", async () => {
    const admin = await adminWithModels("stg_deals");
    const worker = new InMemoryWorkerClient();

    await caller(admin, "a@example.test", "vi", { worker }).models.build({
      tenantId: TENANT,
      name: "stg_deals",
    });

    expect(worker.builds.asked.map((asked) => asked.select)).toEqual([["stg_deals"]]);
  });

  it("a name the customer has no model of is NOT_FOUND naming it, and nothing is built", async () => {
    // dbt answers a selector that matches nothing with a green build of nothing: the one answer
    // this must never pass on as a success.
    const admin = await adminWithModels("stg_deals");
    const worker = new InMemoryWorkerClient();

    const got = await refusedWith(() =>
      caller(admin, "a@example.test", "en", { worker }).models.build({
        tenantId: TENANT,
        names: ["stg_deals", "+stg_dels", "stg_dels+", "fct_gone"],
      }),
    );

    expect(got.code).toBe("NOT_FOUND");
    expect(got.message).toBe(
      "This customer has no model named stg_dels, fct_gone. Check the names against the list of models; nothing was built.",
    );
    expect(got.facts).toEqual({ reason: "MODEL_NOT_FOUND", missing: "stg_dels,fct_gone" });
    expect(worker.builds.asked).toEqual([]);
  });

  it("a selector beyond name, +name and name+ is refused before anything reads it", async () => {
    const admin = await adminWithModels("stg_deals");
    const worker = new InMemoryWorkerClient();

    for (const selector of ["+stg_deals+", "tag:finance", "stg_deals --full-refresh", "@stg"]) {
      const got = await refusal(() =>
        caller(admin, "a@example.test", "vi", { worker }).models.build({
          tenantId: TENANT,
          names: [selector],
        }),
      );
      expect(got.code).toBe("BAD_REQUEST");
    }
    expect(worker.builds.asked).toEqual([]);
  });

  it("both `name` and `names`, or neither, is refused in the caller's language", async () => {
    const admin = await adminWithModels("stg_deals");
    const worker = new InMemoryWorkerClient();
    const { build } = caller(admin, "a@example.test", "en", { worker }).models;

    const both = await refusal(() =>
      build({ tenantId: TENANT, name: "stg_deals", names: ["stg_deals"] }),
    );
    const neither = await refusal(() => build({ tenantId: TENANT }));

    expect([both, neither]).toEqual([
      {
        code: "BAD_REQUEST",
        message: "Give exactly one of name, for one model, or names, for a list of models.",
      },
      {
        code: "BAD_REQUEST",
        message: "Give exactly one of name, for one model, or names, for a list of models.",
      },
    ]);
    expect(worker.builds.asked).toEqual([]);
  });

  it("`wait: false` answers with the run at once, and the trail says it was not waited for", async () => {
    const admin = await adminWithModels("stg_deals");
    const worker = new InMemoryWorkerClient();

    const started = await caller(admin, "a@example.test", "vi", { worker }).models.build({
      tenantId: TENANT,
      names: ["stg_deals+"],
      wait: false,
    });

    expect(started).toEqual({ waited: false, runId: "run-mem-build-1" });
    expect(worker.builds.asked.map((asked) => asked.wait)).toEqual([false]);
    expect((await buildTrail())[0]?.detail).toEqual({
      names: ["stg_deals+"],
      runId: "run-mem-build-1",
      waited: false,
    });
  });

  it("a build already running is a CONFLICT naming the run that holds it, and since when", async () => {
    const admin = await adminWithModels("stg_deals");
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO ops.run (id, tenant_id, source, verb, trigger, started_at)
         VALUES ('run-held', $1, '*', 'transform', 'build', '2026-10-13T02:05:00Z')`,
        [TENANT],
      ),
    );
    const worker = new InMemoryWorkerClient().runningAs("run-held");

    const got = await refusedWith(() =>
      caller(admin, "a@example.test", "en", { worker }).models.build({
        tenantId: TENANT,
        name: "stg_deals",
      }),
    );

    expect(got.code).toBe("CONFLICT");
    // The run, and the minute in Singapore time, as every screen and email words an instant. The
    // joint between date and time is ICU's ("at" on one build, a comma on another), so not pinned.
    expect(got.message).toStartWith("A build is already running for this customer: run run-held,");
    expect(got.message).toContain("13 Oct 2026");
    expect(got.message).toContain("10:05");
    expect(got.facts).toEqual({
      reason: "BUILD_IN_PROGRESS",
      runId: "run-held",
      startedAt: "2026-10-13T02:05:00.000Z",
    });
  });

  it("a holder the ledger does not have is not named: it is a build, running, and nothing more", async () => {
    // The holder can close between the worker's refusal and this read. Naming a run that is not
    // there would send an agent to wait on nothing.
    const admin = await adminWithModels("stg_deals");
    const worker = new InMemoryWorkerClient().runningAs("run-gone");

    const got = await refusedWith(() =>
      caller(admin, "a@example.test", "en", { worker }).models.build({
        tenantId: TENANT,
        name: "stg_deals",
      }),
    );

    expect(got.code).toBe("CONFLICT");
    expect(got.message).toBe(
      "A build is already running for this customer. Wait for it to finish, then try again.",
    );
    expect(got.facts).toEqual({ reason: "BUILD_IN_PROGRESS", runId: null, startedAt: null });
  });

  it("the answer leads with the summary and lists the problems, unless every step is asked for", async () => {
    // Issue 441: a build answered with every step, about 300 bytes each, to find the one that
    // failed. The skipped test is counted as skipped, never as a pass, and is not a problem.
    const admin = await adminWithModels("stg_deals");
    function step(kind: "model" | "test", name: string, status: string) {
      return {
        uniqueId: `${kind}.undercroft.${name}`,
        kind,
        name,
        status,
        failures: status === "fail" ? 2 : null,
        relation: null,
        message: null,
        executionMs: 10,
      };
    }
    const steps = [
      step("model", "stg_deals", "success"),
      step("test", "not_null_stg_deals_deal_id", "pass"),
      step("test", "unique_stg_deals_deal_id", "fail"),
      step("test", "not_null_stg_deals_owner", "skipped"),
    ];
    const worker = new InMemoryWorkerClient();
    worker.builds.answering({
      ok: true,
      testsFailed: 1,
      error: null,
      steps,
      rowCounts: [{ name: "stg_deals", rows: 1204 }],
      preview: null,
    });
    const { build } = caller(admin, "a@example.test", "vi", { worker }).models;

    const lean = await build({ tenantId: TENANT, name: "stg_deals" });
    const whole = await build({ tenantId: TENANT, name: "stg_deals", steps: "all" });
    if (!(lean.waited && whole.waited)) {
      throw new Error("a build is waited for unless asked not to be");
    }

    expect(lean.stepSummary).toEqual({
      total: 4,
      byStatus: { model: { success: 1 }, test: { pass: 1, fail: 1, skipped: 1 } },
      problems: 1,
    });
    expect(lean.steps.map((s) => s.name)).toEqual(["unique_stg_deals_deal_id"]);
    expect([lean.testsFailed, lean.rowCounts]).toEqual([1, [{ name: "stg_deals", rows: 1204 }]]);
    expect(whole.steps).toHaveLength(4);
  });

  it("the reference names the platform's source and its macros for any member", async () => {
    const viewer = await seedMember("v@example.test", "viewer");
    const reference = await caller(viewer, "v@example.test").models.reference({ tenantId: TENANT });
    expect(reference.sourcesYml).toContain("name: undercroft");
    expect(reference.macros.map((m) => m.name)).toEqual([
      "parse_amount",
      "generate_schema_name",
      "gmail_letters",
      "excel_serial_date",
      "excel_serial_timestamp",
    ]);
  });
});

describe("dq.failures", () => {
  it("a member is refused: failing rows are source data; an admin reads them", async () => {
    const member = await seedMember("m@example.test", "member");
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient();
    const input = { tenantId: TENANT, runId: "r-1", uniqueId: "test.undercroft.x.a1" };

    const got = await refusal(() =>
      caller(member, "m@example.test", "vi", { worker }).dq.failures(input),
    );
    expect(got.code).toBe("FORBIDDEN");
    expect(await caller(admin, "a@example.test", "vi", { worker }).dq.failures(input)).toEqual({
      columns: [],
      rows: [],
      truncated: false,
    });
  });
});

describe("models.check", () => {
  const RECORDS = "select source_record_id from {{ source('undercroft', 'records') }}";

  it("any member may check, and hears each finding in their own language", async () => {
    const viewer = await seedMember("v@example.test", "viewer");
    const checked = await caller(viewer, "v@example.test", "en").models.check({
      tenantId: TENANT,
      name: "stg_deals",
      sql: `${RECORDS};`,
      tests: { columns: {} },
    });

    expect(checked.findings.map((f) => [f.code, f.severity, f.line])).toEqual([
      ["semicolon", "error", 1],
      ["no-tombstone-filter", "warning", null],
    ]);
    expect(checked.findings[0]?.message).toContain("semicolon");
    expect(checked.unverified.map((u) => u.code)).toContain("compiles");
    expect(checked.unverified[0]?.message.length).toBeGreaterThan(0);
  });

  it("Vietnamese by default, and never the English sentence", async () => {
    const viewer = await seedMember("v@example.test", "viewer");
    const input = { tenantId: TENANT, name: "stg_deals", sql: "select 1;", tests: { columns: {} } };
    const vi = await caller(viewer, "v@example.test").models.check(input);
    const en = await caller(viewer, "v@example.test", "en").models.check(input);

    expect(vi.findings[0]?.message).not.toBe(en.findings[0]?.message);
  });

  it("a ref is checked against the tenant's own models", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const api = caller(admin, "a@example.test");
    await api.models.save({ ...DRAFT, create: true });
    function check(sql: string) {
      return api.models.check({ tenantId: TENANT, name: "fct_deals", sql, tests: { columns: {} } });
    }

    expect((await check("select * from {{ ref('stg_deals') }}")).findings).toEqual([]);
    expect((await check("select * from {{ ref('stg_gone') }}")).findings).toContainEqual(
      expect.objectContaining({ code: "unknown-ref", subject: "stg_gone" }),
    );
  });

  it("a read-only credential may check: it changes nothing", async () => {
    const viewer = await seedMember("v@example.test", "viewer");
    const checked = await caller(viewer, "v@example.test", "vi", { grant: "read" }).models.check({
      tenantId: TENANT,
      name: "stg_deals",
      sql: "select 1 as one",
      tests: { columns: {} },
    });
    expect(checked.findings).toEqual([]);
  });

  it("a read-only credential still may not save", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const got = await refusal(() =>
      caller(admin, "a@example.test", "vi", { grant: "read" }).models.save(DRAFT),
    );
    expect(got.code).toBe("FORBIDDEN");
  });
});

describe("models.delete", () => {
  it("removes an existing model; a name that is not there is NOT_FOUND", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const api = caller(admin, "a@example.test", "vi", { worker: new InMemoryWorkerClient() });
    await api.models.save({ ...DRAFT, create: true });

    expect(await api.models.delete({ tenantId: TENANT, name: "stg_deals" })).toEqual({ ok: true });
    const got = await refusal(() => api.models.delete({ tenantId: TENANT, name: "stg_deals" }));
    expect(got.code).toBe("NOT_FOUND");
  });

  it("with nothing to drop the tables, nothing is deleted and the reader is told so", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const api = caller(admin, "a@example.test", "en", { worker: null });
    await api.models.save({ ...DRAFT, create: true });

    const got = await refusal(() => api.models.delete({ tenantId: TENANT, name: "stg_deals" }));
    expect(got.code).toBe("PRECONDITION_FAILED");
    expect(got.message).toContain("was not deleted");
    expect((await api.models.get({ tenantId: TENANT, name: "stg_deals" })).sql).toBe("select 1");
  });

  it("a model another reads from is a CONFLICT naming the reader, and stays", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient().dependedOnBy(["fct_pipeline"]);
    const api = caller(admin, "a@example.test", "en", { worker });
    await api.models.save({ ...DRAFT, create: true });

    const got = await refusal(() => api.models.delete({ tenantId: TENANT, name: "stg_deals" }));
    expect(got.code).toBe("CONFLICT");
    expect(got.message).toContain("fct_pipeline");
    expect((await api.models.list({ tenantId: TENANT })).map((m) => m.name)).toEqual(["stg_deals"]);
  });
});

describe("models.lineage", () => {
  it("a viewer reads what the saved models and macros declare, missing refs kept", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const viewer = await seedMember("v@example.test", "viewer");
    const api = caller(admin, "a@example.test");
    await api.macros.save({
      tenantId: TENANT,
      name: "deals_base",
      description: "The deals.",
      sql: "{% macro deals_base() %}{{ source('undercroft', 'records') }}{% endmacro %}",
      create: true,
    });
    await api.models.save({ ...DRAFT, sql: "select * from {{ deals_base() }} d", create: true });
    await api.models.save({
      ...DRAFT,
      name: "mart",
      sql: "select * from {{ ref('stg_deals') }} join {{ ref('stg_gone') }} using (id)",
      create: true,
    });

    const graph = await caller(viewer, "v@example.test").models.lineage({ tenantId: TENANT });
    expect(graph.edges).toEqual([
      { from: "model:stg_deals", to: "model:mart", via: null },
      { from: "missing:stg_gone", to: "model:mart", via: null },
      { from: "raw:raw.records", to: "model:stg_deals", via: "deals_base" },
    ]);
  });

  it("a person who is not a member is told the customer is not there", async () => {
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
      ["x@example.test"],
    );
    const got = await refusal(() =>
      caller(rows[0]?.id ?? "", "x@example.test").models.lineage({ tenantId: TENANT }),
    );
    expect(got.code).toBe("NOT_FOUND");
  });

  it("with a name, answers the part around that node alone (issue 443)", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const api = caller(admin, "a@example.test");
    const readsDeals = "select * from {{ ref('stg_deals') }}";
    await api.models.save({ ...DRAFT, create: true });
    await api.models.save({ ...DRAFT, name: "mart", sql: readsDeals, create: true });
    // mart's sibling: it reads what mart reads, and nothing joins it to mart.
    await api.models.save({ ...DRAFT, name: "stg_other", sql: readsDeals, create: true });

    const part = await api.models.lineage({ tenantId: TENANT, name: "mart" });

    expect(part).toEqual({
      nodes: [
        { kind: "model", id: "model:mart", name: "mart", undeclared: [] },
        { kind: "model", id: "model:stg_deals", name: "stg_deals", undeclared: [] },
      ],
      edges: [{ from: "model:stg_deals", to: "model:mart", via: null }],
    });
  });

  it("a name no node carries is NOT_FOUND naming it, never an empty graph", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const api = caller(admin, "a@example.test", "en");
    await api.models.save({ ...DRAFT, create: true });

    const got = await refusal(() => api.models.lineage({ tenantId: TENANT, name: "stg_dealz" }));

    expect(got.code).toBe("NOT_FOUND");
    expect(got.message).toContain("stg_dealz");
  });
});
