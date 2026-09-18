/**
 * Invitations: the loop that makes invite-only sign-in usable.
 *
 * The gate admits an address with a live `app.invitation` row. These procedures are the only
 * supported way such a row comes to exist, so the assertion that matters most is the one
 * that joins the two halves: an invitation issued through the API is an invitation the gate
 * then accepts. Test them apart and both can be right while the product does not work.
 *
 * PGlite with the real migrations, and the real router through `createCaller`. Authorization
 * is exercised by constructing the context directly, as `authz.test.ts` does -- who may call
 * a procedure is a different question from who may hold a session.
 */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { resolveInvitedUser } from "../services/invite.ts";
import { appRouter } from "./router.ts";
import type { Context, Role, SessionUser } from "./trpc.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
});

afterEach(async () => {
  await db.close();
});

async function seedMember(email: string, role: Role, tenantId = "CASE-0042"): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.app_user (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = app.app_user.email RETURNING id`,
    [email],
  );
  const userId = rows[0]!.id;
  await db.query(
    `INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [tenantId, userId, role],
  );
  return userId;
}

function caller(user: SessionUser) {
  const ctx: Context = {
    exec: db,
    user,
    sessionId: "s1",
    endSession: () => Promise.resolve(),
    notifyInvitation: () => Promise.resolve(true),
  };
  return appRouter.createCaller(ctx);
}

/** An admin of CASE-0042, which is who most of these tests act as. */
async function admin() {
  const userId = await seedMember("boss@example.test", "admin");
  return caller({ userId, email: "boss@example.test" });
}

async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_ERROR";
  } catch (error) {
    return error instanceof TRPCError ? error.code : "UNKNOWN";
  }
}

describe("only an admin may grant access to a tenant", () => {
  test("a member cannot invite", async () => {
    // The firing case. An invitation grants a role inside a customer's tenant, and the
    // buttons behind that role mint OAuth tokens into their accounting system.
    const userId = await seedMember("hand@example.test", "member");
    const api = caller({ userId, email: "hand@example.test" });

    const code = await errorCode(() =>
      api.people.invite({ tenantId: "CASE-0042", email: "new@example.test", role: "viewer" }),
    );

    expect(code).toBe("FORBIDDEN");
  });

  test("an admin can invite", async () => {
    const api = await admin();

    const result = await api.people.invite({
      tenantId: "CASE-0042",
      email: "new@example.test",
      role: "viewer",
    });

    expect(result.email).toBe("new@example.test");
  });

  test("a non-member is told the tenant does not exist", async () => {
    // Consistent with every other tenant procedure: a 403 would confirm the tenant is real
    // and turn this endpoint into a way to enumerate customers.
    const userId = await seedMember("other@example.test", "admin", "CASE-0043");
    const api = caller({ userId, email: "other@example.test" });

    const code = await errorCode(() =>
      api.people.invite({ tenantId: "CASE-0042", email: "new@example.test", role: "viewer" }),
    );

    expect(code).toBe("NOT_FOUND");
  });
});

describe("an invitation issued through the API is one the sign-in gate accepts", () => {
  test("inviting an address lets it sign in, with the role it was invited as", async () => {
    // The assertion that ties the two halves together. If this passes, the product works
    // end to end: an admin clicks invite, and that person can sign in.
    const api = await admin();
    await api.people.invite({
      tenantId: "CASE-0042",
      email: "invited@example.test",
      role: "member",
    });

    const admitted = await resolveInvitedUser(db, "invited@example.test");

    expect(admitted).not.toBeNull();
    const { rows } = await db.query<{ tenant_id: string; role: string }>(
      `SELECT m.tenant_id, m.role FROM app.tenant_member m
       JOIN app.app_user u ON u.id = m.user_id WHERE u.email = $1`,
      ["invited@example.test"],
    );
    expect(rows).toEqual([{ tenant_id: "CASE-0042", role: "member" }]);
  });

  test("an address that was never invited is still refused", async () => {
    // The quiet side: issuing one invitation must not open the door generally.
    const api = await admin();
    await api.people.invite({
      tenantId: "CASE-0042",
      email: "invited@example.test",
      role: "member",
    });

    expect(await resolveInvitedUser(db, "stranger@example.test")).toBeNull();
  });

  test("an address invited in mixed case can sign in as itself", async () => {
    const api = await admin();
    await api.people.invite({
      tenantId: "CASE-0042",
      email: "  Mixed@Example.TEST ",
      role: "viewer",
    });

    expect(await resolveInvitedUser(db, "mixed@example.test")).not.toBeNull();
  });
});

describe("inviting twice does not grant twice", () => {
  test("re-inviting refreshes the invitation rather than adding a second", async () => {
    // Two open invitations for one address would both be redeemed at first sign-in, which
    // is a confusing way to grant a single membership.
    const api = await admin();
    await api.people.invite({ tenantId: "CASE-0042", email: "new@example.test", role: "viewer" });
    await api.people.invite({ tenantId: "CASE-0042", email: "new@example.test", role: "admin" });

    const open = await api.people.invitations({ tenantId: "CASE-0042" });
    expect(open.filter((i) => i.status === "pending")).toHaveLength(1);
    expect(open[0]?.role).toBe("admin");
  });

  test("inviting someone who already has access is refused, not duplicated", async () => {
    const api = await admin();
    await seedMember("hand@example.test", "member");

    const code = await errorCode(() =>
      api.people.invite({ tenantId: "CASE-0042", email: "hand@example.test", role: "admin" }),
    );

    expect(code).toBe("CONFLICT");
  });
});

describe("an invitation can be withdrawn before it is used", () => {
  test("revoking an open invitation stops it being accepted", async () => {
    const api = await admin();
    const invited = await api.people.invite({
      tenantId: "CASE-0042",
      email: "new@example.test",
      role: "viewer",
    });

    await api.people.revokeInvitation({ tenantId: "CASE-0042", id: invited.id });

    expect(await resolveInvitedUser(db, "new@example.test")).toBeNull();
  });

  test("an admin of one tenant cannot revoke another tenant's invitation", async () => {
    // The scoping guard. Without `tenant_id` in the DELETE, a guessed uuid would be enough.
    const api = await admin();
    const elsewhere = await seedMember("far@example.test", "admin", "CASE-0043");
    const other = caller({ userId: elsewhere, email: "far@example.test" });
    const invited = await api.people.invite({
      tenantId: "CASE-0042",
      email: "new@example.test",
      role: "viewer",
    });

    const code = await errorCode(() =>
      other.people.revokeInvitation({ tenantId: "CASE-0043", id: invited.id }),
    );

    expect(code).toBe("NOT_FOUND");
    expect(await resolveInvitedUser(db, "new@example.test")).not.toBeNull();
  });
});

describe("the roster says who has access", () => {
  test("members are listed with their roles", async () => {
    const api = await admin();
    await seedMember("hand@example.test", "viewer");

    const members = await api.people.members({ tenantId: "CASE-0042" });

    expect(members).toEqual([
      { userId: expect.any(String), email: "boss@example.test", role: "admin" },
      { userId: expect.any(String), email: "hand@example.test", role: "viewer" },
    ]);
  });
});
