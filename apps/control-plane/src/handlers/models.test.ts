/**
 * Models over tRPC: who may write one, and what a taken name is told.
 *
 * The role gate is pinned from both sides -- a member is refused, an admin is answered --
 * and the one worded refusal on this router, a name already in use, arrives in the
 * caller's language.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { InMemoryWorkerClient } from "../services/inMemoryWorkerClient.ts";
import type { WorkerClient } from "../services/workerClient.ts";
import { appRouter } from "./router.ts";
import type { Context, Role } from "./trpc.ts";

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
  worker: WorkerClient | null = null,
) {
  const ctx: Context = {
    exec: db,
    user: { userId, email },
    credentialId: "s1",
    via: "session",
    grant: "write",
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
  it("a member is refused; an admin's build reaches the worker and is on the trail", async () => {
    const member = await seedMember("m@example.test", "member");
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient();

    const got = await refusal(() =>
      caller(member, "m@example.test", "vi", worker).models.build({
        tenantId: TENANT,
        name: "stg_deals",
      }),
    );
    expect(got.code).toBe("FORBIDDEN");

    const built = await caller(admin, "a@example.test", "vi", worker).models.build({
      tenantId: TENANT,
      name: "stg_deals",
    });
    expect(built.ok).toBe(true);
    expect(worker.built).toEqual([{ tenantId: TENANT, model: "stg_deals", triggeredBy: admin }]);
    const { rows } = await db.query<{ action: string }>(
      "SELECT action FROM ops.audit_log WHERE tenant_id = $1",
      [TENANT],
    );
    expect(rows.map((r) => r.action)).toEqual(["models.build"]);
  });

  it("a build already running is a CONFLICT the person can wait out, worded", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient().failing("in-progress");
    const got = await refusal(() =>
      caller(admin, "a@example.test", "en", worker).models.build({
        tenantId: TENANT,
        name: "stg_deals",
      }),
    );
    expect(got.code).toBe("CONFLICT");
    expect(got.message).toContain("already running");
  });

  it("the reference names the platform's source and its macros for any member", async () => {
    const viewer = await seedMember("v@example.test", "viewer");
    const reference = await caller(viewer, "v@example.test").models.reference({ tenantId: TENANT });
    expect(reference.sourcesYml).toContain("name: undercroft");
    expect(reference.macros.map((m) => m.name)).toEqual([
      "parse_amount",
      "generate_schema_name",
      "gmail_letters",
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
      caller(member, "m@example.test", "vi", worker).dq.failures(input),
    );
    expect(got.code).toBe("FORBIDDEN");
    expect(await caller(admin, "a@example.test", "vi", worker).dq.failures(input)).toEqual({
      columns: [],
      rows: [],
      truncated: false,
    });
  });
});

describe("models.delete", () => {
  it("removes an existing model; a name that is not there is NOT_FOUND", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const api = caller(admin, "a@example.test");
    await api.models.save({ ...DRAFT, create: true });

    expect(await api.models.delete({ tenantId: TENANT, name: "stg_deals" })).toEqual({ ok: true });
    const got = await refusal(() => api.models.delete({ tenantId: TENANT, name: "stg_deals" }));
    expect(got.code).toBe("NOT_FOUND");
  });
});
