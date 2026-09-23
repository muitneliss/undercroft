/**
 * The ledger over tRPC: who may read it, and what a run looks like from the interface.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { DEFAULT_LOCALE } from "@undercroft/core";
import { closeRun, openRun, recordEntities, recordRefusals } from "@undercroft/db/repos";
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
    sessionId: "s1",
    superadmin: false,
    locale: DEFAULT_LOCALE,
    endSession: () => Promise.resolve(),
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () => Promise.resolve({ ok: false as const, reason: "not-configured" as const }),
    worker,
    googlePicker: null,
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
  it("a viewer reads the tenant's ledger, newest first, with entities and counts", async () => {
    const viewer = await seedMember("v@example.test", "viewer", "CASE-0042");
    const page = await caller(viewer, "v@example.test").runs.list({ tenantId: "CASE-0042" });

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

describe("runs.get", () => {
  it("returns the run with its refusals and their reasons", async () => {
    const member = await seedMember("m@example.test", "member", "CASE-0042");
    const run = await caller(member, "m@example.test").runs.get({
      tenantId: "CASE-0042",
      runId: "r-ok",
    });
    expect(run.refusals.map((r) => [r.sourceRecordId, r.reason])).toEqual([
      ["d-7", "no value at idPath"],
    ]);
    expect(run.entityCounts[0]?.entity).toBe("deals");
    expect(run.steps).toEqual([]);
  });

  it("a run of another tenant is NOT_FOUND, never FORBIDDEN", async () => {
    const member = await seedMember("m@example.test", "member", "CASE-0042");
    expect(
      await errorCode(() =>
        caller(member, "m@example.test").runs.get({ tenantId: "CASE-0042", runId: "r-other" }),
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

  it("a run already in progress is CONFLICT, worded, and nothing is audited", async () => {
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
    const { rows } = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM ops.audit_log WHERE action = 'runs.trigger'",
    );
    expect(rows[0]?.n).toBe("0");
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
