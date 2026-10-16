/**
 * A customer's own roles (ADR 0141), through the real router against PGlite: what a role lets its
 * holder do, who may define one, and when one may be deleted.
 *
 * The callers act as `undercroft_app`, as the control plane does. Fixtures a person could not
 * make through the router -- a role naming a permission the catalogue has since retired -- are
 * planted through `asSuperuser`.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { Permission } from "@undercroft/contracts/access";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryWorkerClient } from "../services/inMemoryWorkerClient.ts";
import { resolveInvitedUser } from "../services/invite.ts";
import type { WorkerClient } from "../services/workerClient.ts";
import { appRouter } from "./router.ts";
import { type Context, refusalFacts } from "./trpc.ts";

const TENANT = "CASE-0042";

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

function caller(email: string, userId: string, worker: WorkerClient | null = null) {
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

/** A member of the customer at `role`, as a caller. */
async function as(email: string, role: string, worker: WorkerClient | null = null) {
  return caller(email, await seedMember(email, role), worker);
}

/** The refusal's code and facts, or `NO_ERROR`. */
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

/** An admin defines a role for the tests that need one, through the router. */
async function defineRole(key: string, permissions: Permission[]): Promise<void> {
  const admin = await as(`admin-${key}@example.test`, "admin");
  await admin.roles.save({ tenantId: TENANT, key, label: key, permissions, create: true });
}

/** A person holding exactly `permissions`, through a role `key` defined for them. */
async function holding(key: string, permissions: Permission[]) {
  await defineRole(key, permissions);
  return await as(`${key}@example.test`, key);
}

describe("a customer's own role is what it holds", () => {
  it("a role holding lake:read reads the raw lake and is refused a model by name", async () => {
    await defineRole("raw_reader", ["lake:read"]);
    const worker = new InMemoryWorkerClient().answering({
      columns: [{ name: "n", type: "int8" }],
      rows: [["1"]],
      truncated: false,
    });
    const reader = await as("r@example.test", "raw_reader", worker);

    const answered = await reader.lake.query({ tenantId: TENANT, sql: "select 1 as n" });
    const save = await refused(() =>
      reader.models.save({ tenantId: TENANT, name: "m", sql: "select 1", tests: { columns: {} } }),
    );

    expect(answered.rows).toEqual([["1"]]);
    expect(save).toEqual({
      code: "FORBIDDEN",
      facts: { reason: "PERMISSION_REQUIRED", permission: "models:write", tenantId: TENANT },
    });
    expect((await reader.tenants.get({ tenantId: TENANT })).permissions).toEqual(["lake:read"]);
    expect((await reader.tenants.list())[0]?.permissions).toEqual(["lake:read"]);
  });

  it("a permission the catalogue no longer knows projects nothing", async () => {
    // Saved before the catalogue lost it: the row keeps the string, and the projection refuses
    // to read it as anything (fail closed).
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO app.access_role (tenant_id, key, label, permissions)
         VALUES ($1, 'legacy', 'Legacy', ARRAY['models:fly', 'reports:author'])`,
        [TENANT],
      ),
    );
    const legacy = await as("l@example.test", "legacy");

    expect((await legacy.tenants.get({ tenantId: TENANT })).permissions).toEqual([
      "reports:author",
    ]);
    const listed = await legacy.roles.get({ tenantId: TENANT, key: "legacy" });
    expect(listed.permissions).toEqual(["reports:author"]);
  });
});

describe("roles.list", () => {
  it("shows a viewer the built-ins and the customer's own role, with the catalogue", async () => {
    await defineRole("accountant", ["reports:author", "lake:read"]);
    const viewer = await as("v@example.test", "viewer");
    await seedMember("a1@example.test", "accountant");

    const answer = await viewer.roles.list({ tenantId: TENANT });

    expect(
      answer.roles.map((role) => [role.key, role.builtin, role.permissions, role.members]),
    ).toEqual([
      ["viewer", true, [], 1],
      ["member", true, ["reports:author"], 0],
      ["builder", true, ["reports:author", "models:write", "lake:read"], 0],
      ["admin", true, answer.permissions, 1],
      ["accountant", false, ["reports:author", "lake:read"], 1],
    ]);
    expect(answer.roles.at(-1)?.label).toBe("accountant");
  });

  it("narrows by key, and refuses a key the customer does not have", async () => {
    const viewer = await as("v@example.test", "viewer");

    const narrowed = await viewer.roles.list({ tenantId: TENANT, names: ["builder"] });
    const unknown = await refused(() =>
      viewer.roles.list({ tenantId: TENANT, names: ["auditor"] }),
    );

    expect(narrowed.roles.map((role) => role.key)).toEqual(["builder"]);
    expect(unknown.code).toBe("NOT_FOUND");
  });
});

describe("roles.save", () => {
  it("creates a role, then answers unchanged for the same content and saves an edit", async () => {
    const admin = await as("a@example.test", "admin");
    const role = {
      tenantId: TENANT,
      key: "accountant",
      label: "Accountant",
      description: "Reads reports and the raw lake",
      permissions: ["lake:read", "reports:author"] satisfies Permission[],
    };

    const created = await admin.roles.save({ ...role, create: true });
    const again = await admin.roles.save(role);
    const edited = await admin.roles.save({ ...role, permissions: ["reports:author"] });

    expect([created.unchanged, again.unchanged, edited.unchanged]).toEqual([false, true, false]);
    const stored = await admin.roles.get({ tenantId: TENANT, key: "accountant" });
    expect([stored.label, stored.description, stored.permissions]).toEqual([
      "Accountant",
      "Reads reports and the raw lake",
      ["reports:author"],
    ]);
  });

  it("with create, refuses a key the customer already has", async () => {
    await defineRole("accountant", []);
    const admin = await as("a@example.test", "admin");

    const taken = await refused(() =>
      admin.roles.save({
        tenantId: TENANT,
        key: "accountant",
        label: "Again",
        permissions: [],
        create: true,
      }),
    );

    expect(taken).toEqual({
      code: "CONFLICT",
      facts: { reason: "ROLE_TAKEN", role: "accountant" },
    });
  });

  it("refuses a built-in's key, whatever is sent, and leaves the built-in as it was", async () => {
    const admin = await as("a@example.test", "admin");

    const edit = await refused(() =>
      admin.roles.save({ tenantId: TENANT, key: "viewer", label: "Viewer", permissions: [] }),
    );
    const create = await refused(() =>
      admin.roles.save({
        tenantId: TENANT,
        key: "admin",
        label: "Mine",
        permissions: [],
        create: true,
      }),
    );

    expect(edit).toEqual({
      code: "BAD_REQUEST",
      facts: { reason: "BUILT_IN_ROLE", role: "viewer" },
    });
    expect(create.code).toBe("BAD_REQUEST");
    expect((await admin.roles.get({ tenantId: TENANT, key: "viewer" })).label).toBeNull();
  });

  it("needs roles:manage", async () => {
    const member = await as("m@example.test", "member");

    const got = await refused(() =>
      member.roles.save({ tenantId: TENANT, key: "mine", label: "Mine", permissions: [] }),
    );

    expect(got.facts).toEqual({
      reason: "PERMISSION_REQUIRED",
      permission: "roles:manage",
      tenantId: TENANT,
    });
  });
});

describe("the subset rule", () => {
  it("a manager of roles without keys:manage cannot define a role holding it", async () => {
    const manager = await holding("role_manager", ["roles:manage", "reports:author"]);

    const beyond = await refused(() =>
      manager.roles.save({
        tenantId: TENANT,
        key: "key_holder",
        label: "Key holder",
        permissions: ["keys:manage", "reports:author"],
        create: true,
      }),
    );
    const within = await manager.roles.save({
      tenantId: TENANT,
      key: "author",
      label: "Author",
      permissions: ["reports:author"],
      create: true,
    });

    expect(beyond).toEqual({
      code: "FORBIDDEN",
      facts: {
        reason: "PERMISSION_NOT_HELD",
        permission: "keys:manage",
        permissions: "keys:manage",
        tenantId: TENANT,
      },
    });
    expect(within.unchanged).toBe(false);
  });

  it("nor take keys:manage away from a role that holds it, nor delete that role", async () => {
    await defineRole("key_holder", ["keys:manage"]);
    const manager = await holding("role_manager", ["roles:manage"]);

    const edit = await refused(() =>
      manager.roles.save({ tenantId: TENANT, key: "key_holder", label: "K", permissions: [] }),
    );
    const removal = await refused(() =>
      manager.roles.delete({ tenantId: TENANT, key: "key_holder" }),
    );

    expect([edit.code, removal.code]).toEqual(["FORBIDDEN", "FORBIDDEN"]);
    const kept = await manager.roles.get({ tenantId: TENANT, key: "key_holder" });
    expect(kept.permissions).toEqual(["keys:manage"]);
  });

  it("nor invite anyone at such a role, nor give it, though people:manage is held", async () => {
    await defineRole("key_holder", ["keys:manage"]);
    const hr = await holding("hr", ["people:manage", "roles:manage"]);
    await seedMember("someone@example.test", "viewer");

    const invite = await refused(() =>
      hr.people.invite({ tenantId: TENANT, email: "new@example.test", role: "key_holder" }),
    );
    const promote = await refused(() =>
      hr.people.setRole({ tenantId: TENANT, email: "someone@example.test", role: "key_holder" }),
    );
    const viewer = await hr.people.invite({
      tenantId: TENANT,
      email: "new@example.test",
      role: "viewer",
    });

    expect([invite.code, promote.code]).toEqual(["FORBIDDEN", "FORBIDDEN"]);
    expect(invite.facts).toMatchObject({
      reason: "PERMISSION_NOT_HELD",
      permission: "keys:manage",
    });
    expect(viewer.role).toBe("viewer");
  });

  it("nor demote or remove an admin, whose role holds what they lack", async () => {
    await seedMember("boss@example.test", "admin");
    await seedMember("boss2@example.test", "admin");
    const hr = await holding("hr", ["people:manage"]);

    const demote = await refused(() =>
      hr.people.setRole({ tenantId: TENANT, email: "boss@example.test", role: "viewer" }),
    );
    const remove = await refused(() =>
      hr.people.removeMember({ tenantId: TENANT, email: "boss@example.test" }),
    );

    expect([demote.code, remove.code]).toEqual(["FORBIDDEN", "FORBIDDEN"]);
  });
});

describe("roles.delete", () => {
  it("is refused while somebody holds the role or an open invitation names it, with the counts", async () => {
    await defineRole("accountant", ["reports:author"]);
    const admin = await as("a@example.test", "admin");
    await seedMember("held@example.test", "accountant");
    await admin.people.invite({ tenantId: TENANT, email: "soon@example.test", role: "accountant" });

    const got = await refused(() => admin.roles.delete({ tenantId: TENANT, key: "accountant" }));

    expect(got).toEqual({
      code: "CONFLICT",
      facts: { reason: "ROLE_IN_USE", role: "accountant", members: "1", invitations: "1" },
    });
  });

  it("deletes a role nobody holds, with the grants to it and its closed invitations", async () => {
    await defineRole("accountant", ["reports:author"]);
    const admin = await as("a@example.test", "admin");
    await admin.grants.save({ tenantId: TENANT, role: "accountant", permission: "lake:read" });
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
         VALUES ($1, 'late@example.test', 'accountant', repeat('0', 64), now() - interval '1 day')`,
        [TENANT],
      ),
    );

    expect(await admin.roles.delete({ tenantId: TENANT, key: "accountant" })).toEqual({ ok: true });
    expect(
      (await admin.roles.list({ tenantId: TENANT })).roles.map((role) => role.key),
    ).not.toContain("accountant");
    expect(await admin.grants.list({ tenantId: TENANT })).toEqual([]);
  });

  it("refuses a built-in, and a key the customer does not have", async () => {
    const admin = await as("a@example.test", "admin");

    const builtIn = await refused(() => admin.roles.delete({ tenantId: TENANT, key: "member" }));
    const absent = await refused(() => admin.roles.delete({ tenantId: TENANT, key: "nobody" }));

    expect([builtIn.code, absent.code]).toEqual(["BAD_REQUEST", "NOT_FOUND"]);
  });
});

describe("a role named in an invitation", () => {
  it("is held by the invitee once they sign in", async () => {
    await defineRole("accountant", ["reports:author", "lake:read"]);
    const admin = await as("a@example.test", "admin");
    await admin.people.invite({ tenantId: TENANT, email: "new@example.test", role: "accountant" });

    const invited = await resolveInvitedUser(db, "new@example.test");
    const api = caller("new@example.test", invited?.appUserId ?? "");
    const tenant = await api.tenants.get({ tenantId: TENANT });

    expect([tenant.role, tenant.permissions]).toEqual([
      "accountant",
      ["lake:read", "reports:author"],
    ]);
  });

  it("must be one the customer has", async () => {
    const admin = await as("a@example.test", "admin");

    const got = await refused(() =>
      admin.people.invite({ tenantId: TENANT, email: "new@example.test", role: "auditor" }),
    );

    expect(got).toEqual({
      code: "NOT_FOUND",
      facts: { reason: "ROLE_NOT_FOUND", role: "auditor" },
    });
  });
});
