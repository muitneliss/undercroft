/**
 * The ledger over tRPC: who may read it, and what a run looks like from the interface.
 *
 * Its readers are builders: the ledger needs `runs:read` (ADR 0147), which a builder holds and a
 * viewer or a member does not -- that refusal is pinned with the other divisions' in
 * `authz.test.ts` -- and a builder still lacks the `sources:manage` that starting a run needs.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { DEFAULT_LOCALE } from "@undercroft/core";
import {
  closeRun,
  openRun,
  recordEntities,
  recordRefusals,
  scopeForRun,
  upsertConnection,
  writeConnectionDetail,
} from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { messages } from "../i18n/index.ts";
import { InMemoryWorkerClient } from "../services/inMemoryWorkerClient.ts";
import type { WorkerClient } from "../services/workerClient.ts";
import { appRouter } from "./router.ts";
import type { Context, Role } from "./trpc.ts";

let db: TestDatabase;

async function seedMember(email: string, role: Role, tenantId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [email],
  );
  const userId = rows[0]?.id ?? "";
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    tenantId,
    userId,
    role,
  ]);
  return userId;
}

function caller(userId: string, email: string, worker: WorkerClient | null = null) {
  const ctx: Context = {
    exec: db,
    user: { userId, email },
    credentialId: "s1",
    via: "session",
    grant: "write",
    superadmin: false,
    locale: DEFAULT_LOCALE,
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

async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_ERROR";
  } catch (error) {
    return error instanceof TRPCError ? error.code : "UNKNOWN";
  }
}

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
  await db.become("undercroft_app");

  await openRun(db, {
    id: "r-ok",
    tenantId: "CASE-0042",
    source: "hubspot",
    verb: "ingest",
    trigger: "schedule",
  });
  await recordEntities(db, "r-ok", [
    { entity: "deals", landed: 5, created: 4, changed: 1, unchanged: 0, refused: 1 },
  ]);
  await recordRefusals(db, "r-ok", [
    { entity: "deals", sourceRecordId: "d-7", reason: "no value at idPath" },
  ]);
  await closeRun(db, "r-ok", { status: "ok", created: 4, changed: 1, refused: 1 });
  await openRun(db, {
    id: "r-running",
    tenantId: "CASE-0042",
    source: "xero",
    verb: "ingest",
    trigger: "manual",
  });
  await openRun(db, {
    id: "r-other",
    tenantId: "CASE-0043",
    source: "hubspot",
    verb: "ingest",
    trigger: "schedule",
  });
});

afterEach(async () => {
  await db.close();
});

describe("runs.list", () => {
  it("derives each run's verdict: a build whose tests fail is ok and tests-failing, never clean", async () => {
    // ADR 0129: the ledger keeps its three statuses (ADR 0051); the verdict is read off them.
    for (const [id, status, testsFailed] of [
      ["r-build-clean", "ok", 0],
      ["r-build-tests", "ok", 2],
      ["r-build-failed", "failed", 0],
    ] as const) {
      await openRun(db, {
        id,
        tenantId: "CASE-0042",
        source: "*",
        verb: "transform",
        trigger: "build",
      });
      await closeRun(db, id, { status, testsFailed });
    }
    const reader = await seedMember("b@example.test", "builder", "CASE-0042");
    const { runs } = caller(reader, "b@example.test");

    const { items } = await runs.list({ tenantId: "CASE-0042", limit: 10 });
    expect(Object.fromEntries(items.map((r) => [r.id, [r.status, r.verdict]]))).toEqual({
      "r-build-clean": ["ok", "clean"],
      "r-build-tests": ["ok", "tests-failing"],
      "r-build-failed": ["failed", "failed"],
      "r-ok": ["ok", "clean"],
      "r-running": ["running", "running"],
    });
    const one = await runs.get({ tenantId: "CASE-0042", runId: "r-build-tests" });
    expect([one.status, one.testsFailed, one.verdict]).toEqual(["ok", 2, "tests-failing"]);
  });

  it("a reader of the journal reads the tenant's ledger, newest first, with entities and counts", async () => {
    const reader = await seedMember("b@example.test", "builder", "CASE-0042");
    const page = await caller(reader, "b@example.test").runs.list({ tenantId: "CASE-0042" });

    // Exact, so it also proves CASE-0043's `r-other` is not in it.
    expect(page.items.map((r) => r.id)).toEqual(["r-running", "r-ok"]);
    const [, ok] = page.items;
    expect(ok?.kind).toBe("ingest");
    expect(ok?.source).toBe("hubspot");
    expect(ok?.entities).toEqual(["deals"]);
    expect(ok?.counts).toEqual({ landed: 5, created: 4, changed: 1, unchanged: 0, refused: 1 });
    // A run still in progress reports no counts: a number still changing is not a number.
    expect(page.items[0]?.counts).toBeNull();
    expect(page.nextCursor).toBeNull();
  });
});

describe("runs.list narrowed to one account", () => {
  it("lists that account's runs and no other's, a second mailbox included", async () => {
    // What a source card opens (ADR 0091). One account, never its kind: the second mailbox is
    // its own source (ADR 0043) and a filter that matched by kind would list both under one card.
    for (const [id, tenantId, source] of [
      ["r-mail-1", "CASE-0042", "gmail"],
      ["r-mail-2", "CASE-0042", "gmail.3fa9c1d2e0ab"],
      ["r-mail-other", "CASE-0043", "gmail"],
    ] as const) {
      await openRun(db, { id, tenantId, source, verb: "ingest", trigger: "schedule" });
    }
    const reader = await seedMember("b@example.test", "builder", "CASE-0042");
    const { runs } = caller(reader, "b@example.test");

    const first = await runs.list({ tenantId: "CASE-0042", source: "gmail" });
    const second = await runs.list({ tenantId: "CASE-0042", source: "gmail.3fa9c1d2e0ab" });

    expect(first.items.map((r) => r.id)).toEqual(["r-mail-1"]);
    expect(second.items.map((r) => r.id)).toEqual(["r-mail-2"]);
  });
});

describe("runs.list narrowed by what it is asked", () => {
  it("passes every filter to the ledger, so a run in progress is one call away", async () => {
    const reader = await seedMember("b@example.test", "builder", "CASE-0042");
    const { runs } = caller(reader, "b@example.test");

    const running = await runs.list({ tenantId: "CASE-0042", status: "running" });
    const manualIngests = await runs.list({
      tenantId: "CASE-0042",
      kind: ["ingest"],
      trigger: "manual",
    });
    const named = await runs.list({ tenantId: "CASE-0042", ids: ["r-ok", "r-other"] });

    expect(running.items.map((r) => r.id)).toEqual(["r-running"]);
    expect(manualIngests.items.map((r) => r.id)).toEqual(["r-running"]);
    // `r-other` is CASE-0043's: naming it finds nothing, and says nothing about it.
    expect(named.items.map((r) => r.id)).toEqual(["r-ok"]);
  });

  it("refuses more than 50 ids, or a time that is not an instant, before reading anything", async () => {
    const reader = await seedMember("b@example.test", "builder", "CASE-0042");
    const { runs } = caller(reader, "b@example.test");
    const ids = Array.from({ length: 51 }, (_, at) => `r-${at}`);

    expect(await errorCode(() => runs.list({ tenantId: "CASE-0042", ids }))).toBe("BAD_REQUEST");
    expect(
      await errorCode(() => runs.list({ tenantId: "CASE-0042", startedAfter: "since ten" })),
    ).toBe("BAD_REQUEST");
  });
});

describe("the scope a run read with", () => {
  async function chooseLabels(labels: string[]): Promise<void> {
    await writeConnectionDetail(db, {
      tenantId: "CASE-0042",
      source: "gmail",
      selectionJson: JSON.stringify({
        labels: labels.map((name, i) => ({ id: `Label_${i}`, name })),
      }),
    });
  }

  it("stays the scope it read with after the connection's scope is saved again", async () => {
    await upsertConnection(db, { tenantId: "CASE-0042", source: "gmail" });
    await chooseLabels(["Invoices", "Receipts"]);
    await openRun(db, {
      id: "r-mail",
      tenantId: "CASE-0042",
      source: "gmail",
      verb: "ingest",
      trigger: "schedule",
    });
    // What the collector asks as it starts reading (`google/collect.ts`).
    await scopeForRun(db, { runId: "r-mail", tenantId: "CASE-0042", source: "gmail" });
    await chooseLabels(["Statements"]);
    const reader = await seedMember("b@example.test", "builder", "CASE-0042");

    const run = await caller(reader, "b@example.test").runs.get({
      tenantId: "CASE-0042",
      runId: "r-mail",
    });

    expect(run.scope?.labels).toEqual(["Invoices", "Receipts"]);
  });

  it("is null for a run that recorded none, never the connection's scope today", async () => {
    // `r-ok` was opened in `beforeEach` and never read a scope -- every run from before ADR 0091
    // is this run. The connection has a scope now, and the run must not borrow it.
    await upsertConnection(db, { tenantId: "CASE-0042", source: "hubspot" });
    await writeConnectionDetail(db, {
      tenantId: "CASE-0042",
      source: "hubspot",
      selectionJson: JSON.stringify({ properties: { companies: ["annualrevenue"] } }),
    });
    const reader = await seedMember("b@example.test", "builder", "CASE-0042");

    const run = await caller(reader, "b@example.test").runs.get({
      tenantId: "CASE-0042",
      runId: "r-ok",
    });

    expect(run.scope).toBeNull();
  });
});

describe("runs.get", () => {
  it("returns the run with its refusals and their reasons", async () => {
    const reader = await seedMember("b@example.test", "builder", "CASE-0042");
    const run = await caller(reader, "b@example.test").runs.get({
      tenantId: "CASE-0042",
      runId: "r-ok",
    });
    expect(run.refusals.map((r) => [r.sourceRecordId, r.reason])).toEqual([
      ["d-7", "no value at idPath"],
    ]);
    expect(run.entityCounts[0]?.entity).toBe("deals");
    expect(run.steps).toEqual([]);
    expect(run.stepSummary.total).toBe(0);
  });

  it("leads with the steps that did not pass, and lists the rest only when asked", async () => {
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO ops.run_step (run_id, unique_id, kind, name, status) VALUES
           ('r-ok', 'model.shop.orders', 'model', 'orders', 'success'),
           ('r-ok', 'test.shop.unique_orders_id', 'test', 'unique_orders_id', 'pass'),
           ('r-ok', 'test.shop.not_null_orders_total', 'test', 'not_null_orders_total', 'fail')`,
      ),
    );
    const reader = await seedMember("b@example.test", "builder", "CASE-0042");
    const { runs } = caller(reader, "b@example.test");

    const problems = await runs.get({ tenantId: "CASE-0042", runId: "r-ok" });
    const all = await runs.get({ tenantId: "CASE-0042", runId: "r-ok", steps: "all" });
    const paged = await runs.get({
      tenantId: "CASE-0042",
      runId: "r-ok",
      steps: "all",
      stepLimit: 2,
    });

    expect(problems.steps.map((s) => s.name)).toEqual(["not_null_orders_total"]);
    expect(problems.stepSummary).toMatchObject({ total: 3, problems: 1 });
    expect(all.steps).toHaveLength(3);
    expect(paged.steps).toHaveLength(2);
    expect(paged.nextStepCursor).not.toBeNull();
  });

  it("waits for a run to settle, and answers with the verdict it then has", async () => {
    const reader = await seedMember("b@example.test", "builder", "CASE-0042");
    const answer = caller(reader, "b@example.test").runs.get({
      tenantId: "CASE-0042",
      runId: "r-running",
      waitSeconds: 10,
    });
    // Sequencing, not an assertion: the wait has read the run as running before it closes. A
    // `get` that did not wait would have answered `running` already.
    await Bun.sleep(1200);
    await db.asSuperuser((tx) => closeRun(tx, "r-running", { status: "failed", error: "boom" }));

    const run = await answer;
    expect(run.status).toBe("failed");
    expect(run.error).toBe("boom");
  });

  it("refuses a wait longer than 50 seconds, before waiting at all", async () => {
    const reader = await seedMember("b@example.test", "builder", "CASE-0042");
    expect(
      await errorCode(() =>
        caller(reader, "b@example.test").runs.get({
          tenantId: "CASE-0042",
          runId: "r-running",
          waitSeconds: 51,
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("a run of another tenant is NOT_FOUND, never FORBIDDEN", async () => {
    const reader = await seedMember("b@example.test", "builder", "CASE-0042");
    expect(
      await errorCode(() =>
        caller(reader, "b@example.test").runs.get({ tenantId: "CASE-0042", runId: "r-other" }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("runs.trigger", () => {
  it("an admin starts a run and gets its id; the worker was asked as the admin's uuid", async () => {
    const worker = new InMemoryWorkerClient();
    const admin = await seedMember("a@example.test", "admin", "CASE-0042");
    const started = await caller(admin, "a@example.test", worker).runs.trigger({
      tenantId: "CASE-0042",
      source: "hubspot",
    });
    expect(started.runId).toBe("run-mem-1");
    expect(worker.triggered).toEqual([
      { source: "hubspot", tenantId: "CASE-0042", triggeredBy: admin },
    ]);
    const { rows } = await db.query<{ action: string; actor: string }>(
      "SELECT action, actor FROM ops.audit_log WHERE action = 'runs.trigger'",
    );
    expect(rows).toEqual([{ action: "runs.trigger", actor: "a@example.test" }]);
  });

  it("a member may not: starting a read of a customer's accounts is an admin's authority", async () => {
    const member = await seedMember("m@example.test", "member", "CASE-0042");
    expect(
      await errorCode(() =>
        caller(member, "m@example.test", new InMemoryWorkerClient()).runs.trigger({
          tenantId: "CASE-0042",
          source: "hubspot",
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("a run already in progress is CONFLICT, worded, and audited as refused rather than run", async () => {
    const admin = await seedMember("a@example.test", "admin", "CASE-0042");
    const worker = new InMemoryWorkerClient().runningAs("run-held");
    const refused = await refusal(() =>
      caller(admin, "a@example.test", worker).runs.trigger({
        tenantId: "CASE-0042",
        source: "hubspot",
      }),
    );
    expect(refused.code).toBe("CONFLICT");
    expect(refused.message).toBe(
      messages(DEFAULT_LOCALE)("error.runInProgress", { source: "hubspot" }),
    );
    const { rows } = await db.query<{ outcome: string; reason: string | null }>(
      "SELECT outcome, reason FROM ops.audit_log WHERE action = 'runs.trigger'",
    );
    expect(rows).toEqual([{ outcome: "refused", reason: "CONFLICT" }]);
  });

  it("a worker that did not answer is PRECONDITION_FAILED; one that refused is BAD_REQUEST", async () => {
    const admin = await seedMember("a@example.test", "admin", "CASE-0042");
    const down = await refusal(() =>
      caller(
        admin,
        "a@example.test",
        new InMemoryWorkerClient().failing("unreachable"),
      ).runs.trigger({ tenantId: "CASE-0042", source: "hubspot" }),
    );
    expect(down.code).toBe("PRECONDITION_FAILED");
    expect(down.message).toBe(messages(DEFAULT_LOCALE)("error.runNotStarted"));

    const refused = await refusal(() =>
      caller(admin, "a@example.test", new InMemoryWorkerClient().failing("refused")).runs.trigger({
        tenantId: "CASE-0042",
        source: "hubspot",
      }),
    );
    expect(refused.code).toBe("BAD_REQUEST");
  });

  it("with no worker configured the answer is PRECONDITION_FAILED, not an outage", async () => {
    const admin = await seedMember("a@example.test", "admin", "CASE-0042");
    expect(
      await errorCode(() =>
        caller(admin, "a@example.test").runs.trigger({ tenantId: "CASE-0042", source: "hubspot" }),
      ),
    ).toBe("PRECONDITION_FAILED");
  });
});
