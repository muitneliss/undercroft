/**
 * The audit log (ADR 0113), through the router as every door calls it, against PGlite.
 *
 * What is promised: an attempt is recorded however it ends, through whichever door; a
 * non-member's attempt never reaches the tenant's own log; and each reader sees exactly the rows
 * their gate admits. What a service writes when its change takes effect is pinned beside that
 * service.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { DEFAULT_LOCALE } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { appRouter } from "./router.ts";
import type { Context, Role, SessionUser } from "./trpc.ts";

let db: TestDatabase;

async function person(email: string, memberships: Record<string, Role> = {}): Promise<SessionUser> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [email],
  );
  const userId = rows[0]?.id ?? "";
  for (const [tenantId, role] of Object.entries(memberships)) {
    await db.query("INSERT INTO ops.tenant (id) VALUES ($1) ON CONFLICT DO NOTHING", [tenantId]);
    await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
      tenantId,
      userId,
      role,
    ]);
  }
  return { userId, email };
}

function caller(user: SessionUser, door: Partial<Context> = {}) {
  return appRouter.createCaller({
    exec: db,
    user,
    credentialId: "session-1",
    via: "session",
    channel: "web",
    grant: "write",
    superadmin: false,
    locale: DEFAULT_LOCALE,
    endSession: () => Promise.resolve(),
    apps: null,
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () =>
      Promise.resolve({ ok: false, reason: "not-configured", provider: "google" } as const),
    worker: null,
    specReads: new Map(),
    googlePicker: null,
    signInMethods: [],
    publicUrl: null,
    ...door,
  });
}

async function codeOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return "NO_ERROR";
  } catch (error) {
    if (!(error instanceof TRPCError)) {
      throw error;
    }
    return error.code;
  }
}

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("what is recorded", () => {
  it("a refused attempt is in the tenant's log as refused, with who tried and why", async () => {
    const admin = await person("admin@example.test", { "CASE-1": "admin" });
    const viewer = await person("viewer@example.test", { "CASE-1": "viewer" });
    expect(
      await codeOf(() =>
        caller(viewer).people.invite({
          tenantId: "CASE-1",
          email: "new@example.test",
          role: "member",
        }),
      ),
    ).toBe("FORBIDDEN");

    const { items: entries } = await caller(admin).audit.tenant({ tenantId: "CASE-1" });
    expect(entries).toMatchObject([
      {
        action: "people.invite",
        actor: "viewer@example.test",
        userId: viewer.userId,
        channel: "web",
        outcome: "refused",
        reason: "FORBIDDEN",
        tenantId: "CASE-1",
      },
    ]);
  });

  it("a read-only token's write is refused before any gate, and recorded with the token", async () => {
    const admin = await person("admin@example.test", { "CASE-1": "admin" });
    const token = {
      via: "token",
      channel: "mcp",
      grant: "read",
      credentialId: "upat_abc",
    } as const;
    expect(
      await codeOf(() =>
        caller(admin, token).runs.trigger({ tenantId: "CASE-1", source: "hubspot" }),
      ),
    ).toBe("FORBIDDEN");

    const { items: entries } = await caller(admin).audit.mine({});
    expect(entries).toMatchObject([
      {
        action: "runs.trigger",
        channel: "mcp",
        credential: "upat_abc",
        outcome: "refused",
        reason: "WRITES_DISABLED",
        tenantId: "CASE-1",
      },
    ]);
  });

  it("a non-member's attempt stays out of the tenant's log, and in their own", async () => {
    const admin = await person("admin@example.test", { "CASE-1": "admin" });
    const outsider = await person("outsider@example.test");
    expect(
      await codeOf(() =>
        caller(outsider).people.removeMember({ tenantId: "CASE-1", email: "admin@example.test" }),
      ),
    ).toBe("NOT_FOUND");

    expect((await caller(admin).audit.tenant({ tenantId: "CASE-1" })).items).toEqual([]);
    expect((await caller(outsider).audit.mine({})).items).toMatchObject([
      {
        action: "people.removeMember",
        outcome: "refused",
        reason: "NOT_FOUND",
        tenantId: null,
        detail: { tenantId: "CASE-1" },
      },
    ]);
  });

  it("an action no service records is recorded by the router, with only the fields it names", async () => {
    const admin = await person("admin@example.test", { "CASE-1": "admin" });
    const invited = await caller(admin).people.invite({
      tenantId: "CASE-1",
      email: "new@example.test",
      role: "member",
    });
    await caller(admin).people.revokeInvitation({ tenantId: "CASE-1", id: invited.id });

    const { items: entries } = await caller(admin).audit.tenant({ tenantId: "CASE-1" });
    expect(entries.map((entry) => [entry.action, entry.outcome, entry.detail])).toEqual([
      ["people.revokeInvitation", "ok", { id: invited.id }],
      ["people.invite", "ok", { email: "new@example.test", role: "member" }],
    ]);
  });

  it("a check that changes nothing leaves no row", async () => {
    const admin = await person("admin@example.test", { "CASE-1": "admin" });
    await caller(admin).models.check({
      tenantId: "CASE-1",
      name: "stg_x",
      sql: "select 1",
      tests: {},
    });

    expect((await caller(admin).audit.mine({})).items).toEqual([]);
  });
});

describe("who reads what", () => {
  it("a person reads their own actions in every tenant, and nobody else's", async () => {
    const ada = await person("ada@example.test", { "CASE-1": "admin", "CASE-2": "admin" });
    const bob = await person("bob@example.test", { "CASE-1": "admin" });
    await caller(ada).session.setLocale({ locale: "en" });
    await caller(ada).tenants.rename({ tenantId: "CASE-2", displayName: "Two" });
    await caller(bob).tenants.rename({ tenantId: "CASE-1", displayName: "One" });

    const { items: entries } = await caller(ada).audit.mine({});
    expect(entries.map((entry) => [entry.action, entry.tenantId])).toEqual([
      ["tenants.rename", "CASE-2"],
      ["session.setLocale", null],
    ]);
  });

  it("a tenant's admin reads everyone's actions there and no other tenant's; a member may not", async () => {
    const ada = await person("ada@example.test", { "CASE-1": "admin", "CASE-2": "admin" });
    const bob = await person("bob@example.test", { "CASE-1": "member" });
    await caller(ada).tenants.rename({ tenantId: "CASE-1", displayName: "One" });
    await caller(ada).tenants.rename({ tenantId: "CASE-2", displayName: "Two" });
    await caller(ada).session.setLocale({ locale: "en" });

    const { items: entries } = await caller(ada).audit.tenant({ tenantId: "CASE-1" });
    expect(entries.map((entry) => [entry.action, entry.tenantId])).toEqual([
      ["tenants.rename", "CASE-1"],
    ]);
    expect(await codeOf(() => caller(bob).audit.tenant({ tenantId: "CASE-1" }))).toBe("FORBIDDEN");
  });

  it("only a superadmin reads every tenant's log", async () => {
    const ada = await person("ada@example.test", { "CASE-1": "admin" });
    const root = await person("root@example.test");
    await caller(ada).tenants.rename({ tenantId: "CASE-1", displayName: "One" });

    expect(await codeOf(() => caller(ada).audit.all({}))).toBe("FORBIDDEN");
    const { items: entries } = await caller(root, { superadmin: true }).audit.all({});
    expect(entries.map((entry) => [entry.action, entry.actor])).toEqual([
      ["tenants.rename", "ada@example.test"],
    ]);
  });

  it("pages newest first, and the last page says there is no next", async () => {
    const ada = await person("ada@example.test");
    for (const locale of ["en", "vi", "en"] as const) {
      await caller(ada).session.setLocale({ locale });
    }

    const first = await caller(ada).audit.mine({ limit: 2 });
    const second = await caller(ada).audit.mine({ limit: 2, cursor: first.nextCursor ?? "" });
    expect([...first.items, ...second.items].map((entry) => entry.detail)).toEqual([
      { locale: "en" },
      { locale: "vi" },
      { locale: "en" },
    ]);
    expect(second.nextCursor).toBeNull();
  });
});
