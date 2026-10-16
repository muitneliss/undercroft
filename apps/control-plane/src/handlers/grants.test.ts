/**
 * Grants of one permission to a role or a person (ADR 0141), through the real router against
 * PGlite: what a grant lets its holder do, until when, and who may give or read one.
 *
 * An expired grant is planted with `expires_at` in the past rather than waited out: the
 * projection compares it with the database's `now()`, so no test sleeps.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { Permission } from "@undercroft/contracts/access";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { appRouter } from "./router.ts";
import { type Context, refusalFacts } from "./trpc.ts";

const TENANT = "CASE-0042";
const DRAFT = { tenantId: TENANT, name: "stg_deals", sql: "select 1", tests: { columns: {} } };

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

async function seedMember(email: string, role: string): Promise<string> {
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

function caller(email: string, userId: string) {
  const ctx: Context = {
    exec: db,
    user: { userId, email },
    credentialId: "s1",
    via: "session",
    grant: "write",
    superadmin: false,
    locale: "en",
    endSession: () => Promise.resolve(),
    apps: null,
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () =>
      Promise.resolve({
        ok: false as const,
        reason: "not-configured" as const,
        provider: "google" as const,
      }),
    worker: null,
    specReads: new Map(),
    googlePicker: null,
    signInMethods: [],
    channel: "web",
    publicUrl: null,
    holdOpen: () => undefined,
  };
  return appRouter.createCaller(ctx);
}

async function as(email: string, role: string) {
  return caller(email, await seedMember(email, role));
}

async function refused(fn: () => Promise<unknown>): Promise<{ code: string; facts: unknown }> {
  try {
    await fn();
    return { code: "NO_ERROR", facts: null };
  } catch (error) {
    if (!(error instanceof TRPCError)) {
      throw error;
    }
    return { code: error.code, facts: refusalFacts(error) };
  }
}

/** Twenty-four hours from now, as an ISO moment with its offset. */
function tomorrow(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

describe("a grant to a person", () => {
  it("lets a viewer save a model, and only in the customer it was granted in", async () => {
    const admin = await as("a@example.test", "admin");
    const viewerId = await seedMember("v@example.test", "viewer");
    const viewer = caller("v@example.test", viewerId);
    const before = await refused(() => viewer.models.save({ ...DRAFT, create: true }));

    await admin.grants.save({
      tenantId: TENANT,
      email: "v@example.test",
      permission: "models:write",
    });
    await viewer.models.save({ ...DRAFT, create: true });

    expect(before.code).toBe("FORBIDDEN");
    expect((await viewer.tenants.get({ tenantId: TENANT })).permissions).toEqual(["models:write"]);
    expect((await viewer.tenants.list())[0]?.permissions).toEqual(["models:write"]);
  });

  it("projects nothing once it has expired, and is listed as expired", async () => {
    const admin = await as("a@example.test", "admin");
    const viewerId = await seedMember("v@example.test", "viewer");
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO app.access_grant (tenant_id, subject_kind, user_id, object, action, expires_at)
         VALUES ($1, 'user', $2, 'perm:models:write', 'use', now() - interval '1 minute')`,
        [TENANT, viewerId],
      ),
    );
    const viewer = caller("v@example.test", viewerId);

    const save = await refused(() => viewer.models.save({ ...DRAFT, create: true }));
    const listed = await admin.grants.list({ tenantId: TENANT, email: "v@example.test" });

    expect(save.code).toBe("FORBIDDEN");
    expect((await viewer.tenants.get({ tenantId: TENANT })).permissions).toEqual([]);
    expect(listed.map((grant) => [grant.permission, grant.expired])).toEqual([
      ["models:write", true],
    ]);
  });

  it("holds until a moment still to come, and saving it again moves that moment", async () => {
    const admin = await as("a@example.test", "admin");
    const viewerId = await seedMember("v@example.test", "viewer");
    const until = tomorrow();

    const first = await admin.grants.save({
      tenantId: TENANT,
      email: "v@example.test",
      permission: "lake:read",
      expiresAt: until,
    });
    const same = await admin.grants.save({
      tenantId: TENANT,
      email: "v@example.test",
      permission: "lake:read",
      expiresAt: until,
    });
    const standing = await admin.grants.save({
      tenantId: TENANT,
      email: "v@example.test",
      permission: "lake:read",
    });

    expect([first.unchanged, same.unchanged, standing.unchanged]).toEqual([false, true, false]);
    expect(standing.id).toBe(first.id);
    const viewer = caller("v@example.test", viewerId);
    expect((await viewer.tenants.get({ tenantId: TENANT })).permissions).toEqual(["lake:read"]);
    const [grant] = await admin.grants.list({ tenantId: TENANT });
    expect([grant?.expiresAt, grant?.expired]).toEqual([null, false]);
  });

  it("goes with the person's membership", async () => {
    const admin = await as("a@example.test", "admin");
    await seedMember("v@example.test", "viewer");
    await admin.grants.save({ tenantId: TENANT, email: "v@example.test", permission: "lake:read" });

    await admin.people.removeMember({ tenantId: TENANT, email: "v@example.test" });

    expect(await admin.grants.list({ tenantId: TENANT })).toEqual([]);
  });

  it("is refused for an address that is no member, and an expiry already passed", async () => {
    const admin = await as("a@example.test", "admin");
    await seedMember("v@example.test", "viewer");

    const stranger = await refused(() =>
      admin.grants.save({ tenantId: TENANT, email: "x@example.test", permission: "lake:read" }),
    );
    const past = await refused(() =>
      admin.grants.save({
        tenantId: TENANT,
        email: "v@example.test",
        permission: "lake:read",
        expiresAt: "2020-01-01T00:00:00Z",
      }),
    );
    const both = await refused(() =>
      admin.grants.save({
        tenantId: TENANT,
        email: "v@example.test",
        role: "viewer",
        permission: "lake:read",
      }),
    );

    expect([stranger.code, past.code, both.code]).toEqual([
      "NOT_FOUND",
      "BAD_REQUEST",
      "BAD_REQUEST",
    ]);
    expect(await admin.grants.list({ tenantId: TENANT })).toEqual([]);
  });
});

describe("a grant to a role", () => {
  it("reaches everyone holding the role in this customer", async () => {
    const admin = await as("a@example.test", "admin");
    const member = await as("m@example.test", "member");

    await admin.grants.save({ tenantId: TENANT, role: "member", permission: "lake:read" });

    expect((await member.tenants.get({ tenantId: TENANT })).permissions).toEqual([
      "lake:read",
      "reports:author",
    ]);
  });

  it("whose object the catalogue no longer knows projects nothing", async () => {
    const member = await as("m@example.test", "member");
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO app.access_grant (tenant_id, subject_kind, role_key, object, action)
         VALUES ($1, 'role', 'member', 'perm:models:fly', 'use')`,
        [TENANT],
      ),
    );

    expect((await member.tenants.get({ tenantId: TENANT })).permissions).toEqual([
      "reports:author",
    ]);
  });
});

describe("who may give, take away and read a grant", () => {
  /** A person holding exactly `permissions`, through a role defined for them. */
  async function holding(key: string, permissions: Permission[]) {
    const admin = await as(`admin-${key}@example.test`, "admin");
    await admin.roles.save({ tenantId: TENANT, key, label: key, permissions, create: true });
    return await as(`${key}@example.test`, key);
  }

  it("a manager of roles without keys:manage can neither grant it nor take it away", async () => {
    const manager = await holding("role_manager", ["roles:manage", "people:manage", "lake:read"]);
    const admin = await as("a@example.test", "admin");
    await seedMember("v@example.test", "viewer");
    const given = await admin.grants.save({
      tenantId: TENANT,
      email: "v@example.test",
      permission: "keys:manage",
    });

    const grant = await refused(() =>
      manager.grants.save({ tenantId: TENANT, email: "v@example.test", permission: "keys:manage" }),
    );
    const revoke = await refused(() => manager.grants.delete({ tenantId: TENANT, id: given.id }));
    const within = await manager.grants.save({
      tenantId: TENANT,
      email: "v@example.test",
      permission: "lake:read",
    });

    expect(grant.facts).toEqual({
      reason: "PERMISSION_NOT_HELD",
      permission: "keys:manage",
      permissions: "keys:manage",
      tenantId: TENANT,
    });
    expect(revoke.code).toBe("FORBIDDEN");
    expect(await manager.grants.delete({ tenantId: TENANT, id: within.id })).toEqual({ ok: true });
    expect((await admin.grants.list({ tenantId: TENANT })).map((g) => g.permission)).toEqual([
      "keys:manage",
    ]);
  });

  it("listing needs people:manage: a member is refused, an admin reads them", async () => {
    const admin = await as("a@example.test", "admin");
    const member = await as("m@example.test", "member");
    await admin.grants.save({ tenantId: TENANT, role: "member", permission: "lake:read" });

    const got = await refused(() => member.grants.list({ tenantId: TENANT }));
    const listed = await admin.grants.list({ tenantId: TENANT, role: "member" });

    expect(got.facts).toEqual({
      reason: "PERMISSION_REQUIRED",
      permission: "people:manage",
      tenantId: TENANT,
    });
    expect(listed.map((g) => [g.subject, g.role, g.permission, g.grantedBy])).toEqual([
      ["role", "member", "lake:read", "a@example.test"],
    ]);
  });

  it("taking a grant away that is not there is NOT_FOUND", async () => {
    const admin = await as("a@example.test", "admin");

    const got = await refused(() =>
      admin.grants.delete({ tenantId: TENANT, id: "00000000-0000-4000-8000-000000000000" }),
    );

    expect(got.code).toBe("NOT_FOUND");
  });
});
