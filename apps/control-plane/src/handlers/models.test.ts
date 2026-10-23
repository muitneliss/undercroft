/**
 * Models over tRPC: who may write one, and what a taken name is told.
 *
 * The permission gate (`models:write`, ADR 0139) is pinned from both sides -- a member is
 * refused, a builder and an admin are answered --
 * and the worded refusals on this router arrive in the caller's language: a name already in
 * use, and a delete that did not happen because what the model built could not be dropped.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { ModelPreview } from "@undercroft/contracts";
import { closeRun, openRun, recordSteps } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { InMemoryWorkerClient } from "../services/inMemoryWorkerClient.ts";
import type { WorkerClient } from "../services/workerClient.ts";
import { appRouter } from "./router.ts";
import { type Context, type Role, refusalFacts } from "./trpc.ts";

const TENANT = "CASE-0042";

/** A list asked no page answers its array (ADR 0133); a page here is the contract broken. */
function wholeList<T>(answer: T[] | { readonly items: T[] }): T[] {
  if (!Array.isArray(answer)) {
    throw new Error("a page of a list that was asked for no page");
  }
  return answer;
}

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
  it("a member is refused: what a dashboard shows needs models:write, named in the refusal", async () => {
    const member = await seedMember("m@example.test", "member");
    const got = await refusedWith(() => caller(member, "m@example.test").models.save(DRAFT));
    expect(got.code).toBe("FORBIDDEN");
    expect(got.facts).toEqual({
      reason: "PERMISSION_REQUIRED",
      permission: "models:write",
      tenantId: TENANT,
    });
  });

  it("a builder saves, without being an admin (issue 481)", async () => {
    const builder = await seedMember("b@example.test", "builder");

    await caller(builder, "b@example.test").models.save({ ...DRAFT, create: true });

    const full = await caller(builder, "b@example.test").models.get({
      tenantId: TENANT,
      name: "stg_deals",
    });
    expect(full.sql).toBe("select 1");
  });

  it("an admin saves, and a reader of the project then reads it back", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const reader = await seedMember("r@example.test", "builder");

    await caller(admin, "a@example.test").models.save({ ...DRAFT, create: true });

    const listed = wholeList(
      await caller(reader, "r@example.test").models.list({ tenantId: TENANT }),
    );
    expect(listed.map((m) => m.name)).toEqual(["stg_deals"]);
    const full = await caller(reader, "r@example.test").models.get({
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

  it("stores richer tests in one spelling, reads them back, and an equal re-save changes nothing", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const api = caller(admin, "a@example.test");
    await api.models.save({ ...DRAFT, name: "stg_invoices", create: true });
    const tests = {
      columns: {
        status: [
          { kind: "accepted_values" as const, values: ["open", "paid"], severity: "warn" as const },
        ],
        invoice_id: [
          { kind: "not_null" as const, severity: "error" as const },
          { kind: "relationships" as const, to: "stg_invoices", field: "invoice_id" },
        ],
      },
      sql: [
        {
          name: "paid_not_after_received",
          sql: "select * from {{ ref('stg_payments') }} where paid_on > received_on",
        },
      ],
    };
    const payments = { tenantId: TENANT, name: "stg_payments", sql: "select 1 as invoice_id" };

    expect(await api.models.save({ ...payments, tests, create: true })).toEqual({
      ok: true,
      unchanged: false,
    });
    const stored = await api.models.get({ tenantId: TENANT, name: "stg_payments" });
    expect(stored.tests).toEqual({
      columns: {
        status: [{ kind: "accepted_values", values: ["open", "paid"], severity: "warn" }],
        invoice_id: [
          "not_null",
          { kind: "relationships", to: "stg_invoices", field: "invoice_id" },
        ],
      },
      sql: tests.sql,
    });
    // The same tests in the stored spelling are the same tests: no write, the same hash.
    expect(await api.models.save({ ...payments, tests: stored.tests })).toEqual({
      ok: true,
      unchanged: true,
    });
    const again = await api.models.get({ tenantId: TENANT, name: "stg_payments" });
    expect(again.testsSha256).toBe(stored.testsSha256);
  });

  it("an unsafe SQL test is refused in the caller's language, naming the test, and nothing is written", async () => {
    const admin = await seedMember("a@example.test", "admin");
    function save(locale: "vi" | "en", sql: string) {
      return refusal(() =>
        caller(admin, "a@example.test", locale).models.save({
          ...DRAFT,
          create: true,
          tests: { columns: {}, sql: [{ name: "paid_on_time", sql }] },
        }),
      );
    }

    const en = await save("en", "select * from {{ ref('stg_deals') }};");
    expect(en.code).toBe("BAD_REQUEST");
    expect(en.message).toStartWith("Nothing was saved. Test paid_on_time: Remove the semicolon.");
    const vi = await save("vi", "select 1 as one");
    expect(vi.message).toStartWith("Chưa lưu gì. Kiểm thử paid_on_time: Kiểm thử SQL phải đọc");
    expect(await caller(admin, "a@example.test").models.list({ tenantId: TENANT })).toEqual([]);
  });

  it("a name that is not a plain identifier is refused before it reaches the database", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const got = await refusal(() =>
      caller(admin, "a@example.test").models.save({ ...DRAFT, name: "Deals-2026" }),
    );
    expect(got.code).toBe("BAD_REQUEST");
  });
});

describe("a model's description (ADR 0137)", () => {
  const DESCRIBED = { ...DRAFT, description: "Một dòng mỗi deal, từ HubSpot." };

  async function adminApi(): Promise<ReturnType<typeof caller>> {
    const admin = await seedMember("a@example.test", "admin");
    return caller(admin, "a@example.test");
  }

  async function storedDescription(api: ReturnType<typeof caller>): Promise<string | null> {
    return (await api.models.get({ tenantId: TENANT, name: DRAFT.name })).description;
  }

  it("is saved and read back, on get and on the list", async () => {
    const api = await adminApi();
    await api.models.save({ ...DESCRIBED, create: true });

    expect(await storedDescription(api)).toBe(DESCRIBED.description);
    expect(wholeList(await api.models.list({ tenantId: TENANT }))[0]?.description).toBe(
      DESCRIBED.description,
    );
  });

  // The CLI, MCP and every caller before ADR 0137 save SQL and tests without one.
  it("is kept by a save that does not mention it", async () => {
    const api = await adminApi();
    await api.models.save({ ...DESCRIBED, create: true });

    await api.models.save({ ...DRAFT, sql: "select 2" });

    expect(await storedDescription(api)).toBe(DESCRIBED.description);
  });

  it("is cleared by null", async () => {
    const api = await adminApi();
    await api.models.save({ ...DESCRIBED, create: true });

    await api.models.save({ ...DRAFT, description: null });

    expect(await storedDescription(api)).toBeNull();
  });

  it("saved again as it is, beside the same SQL and tests, changes nothing", async () => {
    const api = await adminApi();
    await api.models.save({ ...DESCRIBED, create: true });

    expect(await api.models.save(DESCRIBED)).toEqual({ ok: true, unchanged: true });
  });

  // dbt renders a description through Jinja; one that is not valid Jinja breaks every build.
  it("holding a brace is refused before anything is written", async () => {
    const api = await adminApi();
    const got = await refusal(() =>
      api.models.save({ ...DRAFT, description: "Tổng {{ amount }} mỗi deal.", create: true }),
    );

    expect(got.code).toBe("BAD_REQUEST");
    expect(wholeList(await api.models.list({ tenantId: TENANT }))).toEqual([]);
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

    expect(started).toEqual({
      waited: false,
      runId: "run-mem-build-1",
      verdict: "running",
      parentTestsUnknown: [],
    });
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
    // The run, and the minute in Singapore time with the zone named on it: the server cannot know
    // the reader's zone, so a bare 10:05 would read an hour off to a reader in Hanoi with nothing
    // to say so (ADR 0149). The joint between date and time is ICU's ("at" on one build, a comma
    // on another), and so is the zone's short name, so neither is pinned to one spelling.
    expect(got.message).toStartWith("A build is already running for this customer: run run-held,");
    expect(got.message).toContain("13 Oct 2026");
    expect(got.message).toMatch(/10:05 (?:SGT|GMT\+8)/u);
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
      byStatus: { model: { success: 1 }, test: { pass: 1, fail: 1, skipped: 1 }, seed: {} },
      problems: 1,
    });
    expect(lean.steps.map((s) => s.name)).toEqual(["unique_stg_deals_deal_id"]);
    expect([lean.testsFailed, lean.rowCounts]).toEqual([1, [{ name: "stg_deals", rows: 1204 }]]);
    // ADR 0129: the run is `ok` -- its table was written -- and its verdict says the tests failed.
    expect([lean.ok, lean.verdict]).toEqual([true, "tests-failing"]);
    expect(whole.steps).toHaveLength(4);
  });

  it("the reference names the platform's source and its macros for a reader of the project", async () => {
    const reader = await seedMember("r@example.test", "builder");
    const reference = await caller(reader, "r@example.test").models.reference({ tenantId: TENANT });
    if ("parts" in reference) {
      throw new Error("asked for no parts, answered with some");
    }
    expect(reference.sourcesYml).toContain("name: undercroft");
    expect(reference.macros.map((m) => m.name)).toEqual([
      "parse_amount",
      "generate_schema_name",
      "generate_alias_name",
      "gmail_letters",
      "excel_serial_date",
      "excel_serial_timestamp",
    ]);
  });
});

/**
 * A build as the worker writes it to the ledger: a run opened and closed, one model step per
 * model that built, and each test step attributed to the model its manifest names (ADR 0129).
 */
async function ledgerBuild(
  runId: string,
  built: readonly string[],
  tests: readonly { model: string | null; name: string; status: string }[] = [],
): Promise<void> {
  const failed = tests.filter((t) => t.status === "fail" || t.status === "error").length;
  await db.asSuperuser(async (tx) => {
    await openRun(tx, {
      id: runId,
      tenantId: TENANT,
      source: "*",
      verb: "transform",
      trigger: "build",
    });
    await recordSteps(tx, runId, [
      ...built.map((name) => ({
        uniqueId: `model.undercroft.${name}`,
        kind: "model" as const,
        name,
        status: "success",
        failures: null,
        relation: null,
        message: null,
        executionMs: 10,
      })),
      ...tests.map((t) => ({
        uniqueId: `test.undercroft.${t.name}.a1`,
        kind: "test" as const,
        name: t.name,
        status: t.status,
        failures: t.status === "fail" ? 2 : null,
        relation: null,
        message: null,
        executionMs: 5,
        model: t.model,
      })),
    ]);
    await closeRun(tx, runId, { status: "ok", testsFailed: failed });
  });
}

describe("a model's latest tests (issue 456)", () => {
  const PROJECT = [
    { name: "stg_deals", sql: "select 1 as deal_id" },
    { name: "fct_pipeline", sql: "select * from {{ ref('stg_deals') }}" },
    { name: "dim_owner", sql: "select 1 as owner_id" },
  ];

  async function adminWithProject(): Promise<string> {
    const admin = await seedMember("a@example.test", "admin");
    for (const model of PROJECT) {
      await caller(admin, "a@example.test").models.save({ ...DRAFT, ...model, create: true });
    }
    return admin;
  }

  it("list and get say passing, failing with which tests, or unknown -- never passing for no record", async () => {
    const admin = await adminWithProject();
    await ledgerBuild(
      "run-1",
      ["stg_deals", "fct_pipeline", "dim_owner"],
      [
        { model: "stg_deals", name: "not_null_stg_deals_deal_id", status: "fail" },
        { model: "fct_pipeline", name: "unique_fct_pipeline_deal_id", status: "pass" },
        { model: "fct_pipeline", name: "not_null_fct_pipeline_deal_id", status: "warn" },
        // A step dbt's manifest could not attribute belongs to no model, and passes for none.
        { model: null, name: "not_null_dim_owner_owner_id", status: "pass" },
      ],
    );
    const { models } = caller(admin, "a@example.test");

    const listed = wholeList(await models.list({ tenantId: TENANT }));
    expect(Object.fromEntries(listed.map((m) => [m.name, m.lastTests]))).toEqual({
      dim_owner: {
        state: "unknown",
        failing: null,
        warnings: null,
        runId: "run-1",
        endedAt: expect.any(String),
        unpublished: null,
      },
      fct_pipeline: {
        state: "passing",
        failing: 0,
        warnings: 1,
        runId: "run-1",
        endedAt: expect.any(String),
        unpublished: null,
      },
      stg_deals: {
        state: "failing",
        failing: 1,
        warnings: 0,
        runId: "run-1",
        endedAt: expect.any(String),
        unpublished: null,
      },
    });
    // The model step succeeded: the build status alone reads as fine, which was the defect.
    expect(listed.find((m) => m.name === "stg_deals")?.lastBuild?.status).toBe("success");

    const one = await models.get({ tenantId: TENANT, name: "stg_deals" });
    expect(one.lastTests.failingTests).toEqual([
      {
        name: "not_null_stg_deals_deal_id",
        uniqueId: "test.undercroft.not_null_stg_deals_deal_id.a1",
        status: "fail",
        failures: 2,
      },
    ]);
  });

  it("a later build of only the child does not clear a parent's failing tests; a passing rebuild does", async () => {
    const admin = await adminWithProject();
    await ledgerBuild(
      "run-1",
      ["stg_deals"],
      [{ model: "stg_deals", name: "not_null_stg_deals_deal_id", status: "fail" }],
    );
    await ledgerBuild("run-2", ["fct_pipeline"]);
    const { models } = caller(admin, "a@example.test");
    expect((await models.get({ tenantId: TENANT, name: "stg_deals" })).lastTests.state).toBe(
      "failing",
    );

    await ledgerBuild(
      "run-3",
      ["stg_deals"],
      [{ model: "stg_deals", name: "not_null_stg_deals_deal_id", status: "pass" }],
    );
    const after = await models.get({ tenantId: TENANT, name: "stg_deals" });
    expect([after.lastTests.state, after.lastTests.runId]).toEqual(["passing", "run-3"]);
  });

  it("issue 457: building a model alone over a parent whose tests failed is refused, naming them", async () => {
    const admin = await adminWithProject();
    await ledgerBuild(
      "run-1",
      ["stg_deals", "fct_pipeline"],
      [{ model: "stg_deals", name: "not_null_stg_deals_deal_id", status: "fail" }],
    );
    const worker = new InMemoryWorkerClient();
    const { build } = caller(admin, "a@example.test", "en", { worker }).models;

    const got = await refusedWith(() => build({ tenantId: TENANT, name: "fct_pipeline" }));
    expect(got.code).toBe("PRECONDITION_FAILED");
    expect(got.message).toBe(
      "fct_pipeline was not built: the latest tests of its parent stg_deals failed (not_null_stg_deals_deal_id, run run-1), so building fct_pipeline now would copy those rows. Fix and rebuild stg_deals, or build it with its parents as +fct_pipeline.",
    );
    expect(got.facts).toEqual({
      reason: "PARENT_TESTS_FAILING",
      model: "fct_pipeline",
      parent: "stg_deals",
      tests: "not_null_stg_deals_deal_id",
      runId: "run-1",
      parents: "stg_deals",
    });
    expect(worker.builds.asked).toEqual([]);

    // With its parents, or with the parent named beside it, the parent rebuilds and is tested
    // in the same run, before the child: nothing to refuse.
    await build({ tenantId: TENANT, names: ["+fct_pipeline"] });
    await build({ tenantId: TENANT, names: ["stg_deals", "fct_pipeline"] });
    await build({ tenantId: TENANT, names: ["stg_deals+"] });
    // A model that reads no failing parent is not held back by one that does.
    await build({ tenantId: TENANT, name: "dim_owner" });
    expect(worker.builds.asked.map((asked) => asked.select)).toEqual([
      ["+fct_pipeline"],
      ["stg_deals", "fct_pipeline"],
      ["stg_deals+"],
      ["dim_owner"],
    ]);
  });

  it("a parent with no test record does not refuse the build, and is named as unknown", async () => {
    const admin = await adminWithProject();
    const worker = new InMemoryWorkerClient();
    const { build } = caller(admin, "a@example.test", "en", { worker }).models;

    const built = await build({ tenantId: TENANT, name: "fct_pipeline" });
    expect(built.parentTestsUnknown).toEqual(["stg_deals"]);
    expect(built.waited ? built.verdict : null).toBe("clean");

    await ledgerBuild(
      "run-1",
      ["stg_deals"],
      [{ model: "stg_deals", name: "not_null_stg_deals_deal_id", status: "pass" }],
    );
    expect((await build({ tenantId: TENANT, name: "fct_pipeline" })).parentTestsUnknown).toEqual(
      [],
    );
  });
});

describe("dq.failures", () => {
  it("a builder reads them too: lake:read, which an author of models needs (ADR 0139)", async () => {
    const builder = await seedMember("b@example.test", "builder");
    const worker = new InMemoryWorkerClient();
    const input = { tenantId: TENANT, runId: "r-1", uniqueId: "test.undercroft.x.a1" };

    expect(await caller(builder, "b@example.test", "vi", { worker }).dq.failures(input)).toEqual({
      columns: [],
      rows: [],
      truncated: false,
    });
  });

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

  it("a reader of the project may check, and hears each finding in their own language", async () => {
    const reader = await seedMember("r@example.test", "builder");
    const checked = await caller(reader, "r@example.test", "en").models.check({
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
    const reader = await seedMember("r@example.test", "builder");
    const input = { tenantId: TENANT, name: "stg_deals", sql: "select 1;", tests: { columns: {} } };
    const vi = await caller(reader, "r@example.test").models.check(input);
    const en = await caller(reader, "r@example.test", "en").models.check(input);

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
    const reader = await seedMember("r@example.test", "builder");
    const checked = await caller(reader, "r@example.test", "vi", { grant: "read" }).models.check({
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

describe("models.preview (ADR 0132)", () => {
  const SAMPLE = {
    columns: [{ name: "deal_id", type: "integer" }],
    rows: [[1], [2]],
    truncated: false,
    compiled: 'select deal_id from "analytics_case_0042"."base"',
  };
  const PREVIEW = {
    tenantId: TENANT,
    name: "stg_deals",
    sql: "select deal_id from {{ ref('base') }}",
  };

  /** A worker whose every preview answers `answer`. */
  function previewing(answer: ModelPreview): InMemoryWorkerClient {
    const worker = new InMemoryWorkerClient();
    worker.previews.answering(answer);
    return worker;
  }

  it("an admin gets the rows and the SQL dbt compiled, and nothing is saved", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const worker = previewing(SAMPLE);
    const api = caller(admin, "a@example.test", "vi", { worker });
    await api.models.save({ ...DRAFT, create: true });

    expect(await api.models.preview(PREVIEW)).toEqual(SAMPLE);
    expect((await api.models.get({ tenantId: TENANT, name: "stg_deals" })).sql).toBe("select 1");
    expect(wholeList(await api.models.list({ tenantId: TENANT })).map((m) => m.name)).toEqual([
      "stg_deals",
    ]);
  });

  it("an outer query goes to the worker with the draft, and its answer comes back", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const counted = { ...SAMPLE, columns: [{ name: "n", type: "bigint" }], rows: [["2"]] };
    const worker = previewing(counted);
    const api = caller(admin, "a@example.test", "vi", { worker });

    const got = await api.models.preview({
      ...PREVIEW,
      query: " select count(*) as n from stg_deals ",
    });

    expect(got.rows).toEqual([["2"]]);
    expect(worker.previews.asked).toEqual([
      { ...PREVIEW, query: "select count(*) as n from stg_deals", limit: 1000 },
    ]);
  });

  it("a member is refused, and so is an admin's read-only credential: it runs SQL as the login that reads raw", async () => {
    const member = await seedMember("m@example.test", "member");
    const admin = await seedMember("a@example.test", "admin");
    const worker = previewing(SAMPLE);

    const asMember = await refusal(() =>
      caller(member, "m@example.test", "vi", { worker }).models.preview(PREVIEW),
    );
    const readOnly = await refusal(() =>
      caller(admin, "a@example.test", "vi", { worker, grant: "read" }).models.preview(PREVIEW),
    );

    expect([asMember.code, readOnly.code]).toEqual(["FORBIDDEN", "FORBIDDEN"]);
    expect(worker.previews.asked).toEqual([]);
  });

  it("a model dbt would not compile is BAD_REQUEST carrying dbt's cause, in the caller's language", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient();
    worker.previews.refusingCompile("Compilation Error in model base2 (models/base2.sql)");

    const got = await refusal(() =>
      caller(admin, "a@example.test", "en", { worker }).models.preview(PREVIEW),
    );

    expect(got.code).toBe("BAD_REQUEST");
    expect(got.message).toBe(
      "The model stg_deals did not compile, so nothing ran and nothing was saved: Compilation Error in model base2 (models/base2.sql)",
    );
  });

  it("SQL Postgres refused is BAD_REQUEST carrying Postgres's sentence", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient().refusingQueries('column "nope" does not exist');

    const got = await refusal(() =>
      caller(admin, "a@example.test", "en", { worker }).models.preview(PREVIEW),
    );

    expect(got.code).toBe("BAD_REQUEST");
    expect(got.message).toBe('The query did not run: column "nope" does not exist');
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
    expect(wholeList(await api.models.list({ tenantId: TENANT })).map((m) => m.name)).toEqual([
      "stg_deals",
    ]);
  });
});

describe("models.lineage", () => {
  it("a reader of the project reads what the saved models and macros declare, missing refs kept", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const reader = await seedMember("r@example.test", "builder");
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

    const graph = await caller(reader, "r@example.test").models.lineage({ tenantId: TENANT });
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

  /** A lineage's answer: the graph when no page was asked, else one page of it. */
  type Graph = Awaited<ReturnType<ReturnType<typeof caller>["models"]["lineage"]>>;

  /** Every page of a lineage read, each asked after the last until `nextCursor` is null. */
  async function everyPage(read: (cursor: string | undefined) => Promise<Graph>): Promise<Graph[]> {
    const pages: Graph[] = [];
    let cursor: string | undefined;
    do {
      const page = await read(cursor);
      if (!("nextCursor" in page)) {
        throw new Error("the whole graph, though a page was asked");
      }
      pages.push(page);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined && pages.length < 20);
    return pages;
  }

  function atCursor(cursor: string | undefined): { cursor?: string } {
    return cursor === undefined ? {} : { cursor };
  }

  it("a page at a time, around a name: every node and edge once, then no cursor", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const api = caller(admin, "a@example.test");
    const base = "select * from {{ ref('base') }}";
    await api.models.save({ ...DRAFT, name: "base", create: true });
    await api.models.save({ ...DRAFT, name: "stg_a", sql: base, create: true });
    await api.models.save({ ...DRAFT, name: "stg_b", sql: base, create: true });
    await api.models.save({
      ...DRAFT,
      name: "mart",
      sql: "select * from {{ ref('base') }}, {{ ref('stg_a') }}, {{ ref('stg_b') }}, {{ ref('gone') }}",
      create: true,
    });
    // Outside the part around mart: a page that dropped the name would carry it.
    await api.models.save({ ...DRAFT, name: "lone", sql: base, create: true });
    const around = { tenantId: TENANT, name: "mart", direction: "up" as const };

    const part = await api.models.lineage(around);
    const pages = await everyPage((cursor) =>
      api.models.lineage({ ...around, limit: 1, ...atCursor(cursor) }),
    );

    // Five nodes and six edges: the nodes run out a page before the edges do.
    expect([part.nodes.length, part.edges.length]).toEqual([5, 6]);
    expect(pages.map((page) => [page.nodes.length, page.edges.length])).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
      [0, 1],
    ]);
    expect(pages.flatMap((page) => page.nodes)).toEqual([...part.nodes]);
    expect(pages.flatMap((page) => page.edges)).toEqual([...part.edges]);
  });

  it("a cursor whose node has left the graph is refused, never restarted from the top", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const api = caller(admin, "a@example.test", "en", { worker: new InMemoryWorkerClient() });
    for (const name of ["alpha", "beta", "gamma"]) {
      await api.models.save({ ...DRAFT, name, create: true });
    }
    const first = await api.models.lineage({ tenantId: TENANT, limit: 1 });
    const cursor = "nextCursor" in first ? (first.nextCursor ?? undefined) : undefined;
    await api.models.delete({ tenantId: TENANT, name: "alpha" });

    const got = await refusedWith(() =>
      api.models.lineage({ tenantId: TENANT, ...atCursor(cursor) }),
    );

    expect(first.nodes.map((node) => node.name)).toEqual(["alpha"]);
    expect(got.code).toBe("BAD_REQUEST");
    expect(got.facts).toEqual({
      procedure: "models.lineage",
      reason: "unknown-cursor",
      remedy: "restart",
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

describe("models.list, asked what each model depends on (ADR 0137)", () => {
  /** The models listed with `include: ["dependsOn"]`, by name. */
  async function dependsOn(api: ReturnType<typeof caller>): Promise<Map<string, unknown>> {
    const listed = wholeList(await api.models.list({ tenantId: TENANT, include: ["dependsOn"] }));
    return new Map(listed.map((model) => [model.name, model.dependsOn]));
  }

  it("names the model and the reference table a model refs, as the lineage reads them", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const api = caller(admin, "a@example.test");
    await api.seeds.save({
      tenantId: TENANT,
      name: "account_groups",
      columns: [{ name: "code", type: "text" }],
      rows: [["511"]],
    });
    await api.models.save({ ...DRAFT, create: true });
    await api.models.save({
      ...DRAFT,
      name: "mart",
      sql: "select * from {{ ref('stg_deals') }} join {{ ref('account_groups') }} using (code)",
      create: true,
    });

    expect((await dependsOn(api)).get("mart")).toEqual({
      reads: [
        { kind: "model", name: "stg_deals", via: null },
        { kind: "seed", name: "account_groups", via: null },
      ],
      undeclared: [],
    });
  });

  // Rule 2: an upstream nobody can read is said to be unread, never "reads nothing".
  it("says why a model's upstream cannot be read, rather than listing it as reading nothing", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const api = caller(admin, "a@example.test");
    await api.models.save({
      ...DRAFT,
      sql: "select * from {{ ref(var('target')) }}",
      create: true,
    });

    expect((await dependsOn(api)).get("stg_deals")).toEqual({
      reads: [],
      undeclared: [{ code: "dynamic-reference", subject: "ref", via: null }],
    });
  });
});
