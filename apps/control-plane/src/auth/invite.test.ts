/**
 * The invite gate, pinned. This is the control that decides who can hold a session.
 *
 * Real PGlite with the real migrations, and the gate driven directly. Better Auth itself
 * cannot boot here -- it needs a `pg.Pool` and PGlite is one in-process connection -- but
 * the library is not what needs proving. What needs proving is the decision, and every case
 * below is a way in that must or must not work.
 */

import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appUserForEmail, resolveInvitedUser } from "./invite.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

/** An invitation to `tenantId`, live unless `expiresAt` says otherwise. */
async function seedInvitation(
  tenantId: string,
  email: string,
  role: "viewer" | "member" | "admin",
  expiresAt = "now() + interval '7 days'",
): Promise<void> {
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1) ON CONFLICT DO NOTHING", [tenantId]);
  await db.query(
    `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
     VALUES ($1, $2, $3, repeat('a', 64), ${expiresAt})`,
    [tenantId, email, role],
  );
}

async function membershipsOf(email: string): Promise<{ tenant_id: string; role: string }[]> {
  const { rows } = await db.query<{ tenant_id: string; role: string }>(
    `SELECT m.tenant_id, m.role FROM app.tenant_member m
     JOIN app.app_user u ON u.id = m.user_id
     WHERE u.email = $1 ORDER BY m.tenant_id`,
    [email],
  );
  return rows;
}

describe("only an invited address may become a user", () => {
  test("an address with no invitation and no account is refused", async () => {
    // The firing case, and the one that matters: without it, anyone with a Google account
    // reaches the control plane's shell.
    const resolved = await resolveInvitedUser(db, "stranger@example.test");

    expect(resolved).toBeNull();
    const { rows } = await db.query("SELECT id FROM app.app_user");
    expect(rows).toHaveLength(0);
  });

  test("an invited address is provisioned with the role it was invited as", async () => {
    await seedInvitation("CASE-0042", "operator@example.test", "admin");

    const resolved = await resolveInvitedUser(db, "operator@example.test");

    expect(resolved?.email).toBe("operator@example.test");
    expect(await membershipsOf("operator@example.test")).toEqual([
      { tenant_id: "CASE-0042", role: "admin" },
    ]);
  });

  test("accepting an invitation consumes it, so it cannot be reused", async () => {
    await seedInvitation("CASE-0042", "operator@example.test", "member");
    await resolveInvitedUser(db, "operator@example.test");

    const { rows } = await db.query<{ accepted_at: Date | null }>(
      "SELECT accepted_at FROM app.invitation WHERE email = $1",
      ["operator@example.test"],
    );
    expect(rows[0]?.accepted_at).not.toBeNull();
  });

  test("an expired invitation is a no, not a weaker yes", async () => {
    await seedInvitation("CASE-0042", "late@example.test", "member", "now() - interval '1 day'");

    expect(await resolveInvitedUser(db, "late@example.test")).toBeNull();
    expect(await membershipsOf("late@example.test")).toEqual([]);
  });

  test("every live invitation is accepted, not just the first", async () => {
    // Someone invited to two tenants before their first sign-in must land in both, or the
    // second membership stays pending with nothing to trigger it.
    await seedInvitation("CASE-0042", "operator@example.test", "admin");
    await seedInvitation("CASE-0043", "operator@example.test", "viewer");

    await resolveInvitedUser(db, "operator@example.test");

    expect(await membershipsOf("operator@example.test")).toEqual([
      { tenant_id: "CASE-0042", role: "admin" },
      { tenant_id: "CASE-0043", role: "viewer" },
    ]);
  });

  test("a returning user signs in again with no invitation left to accept", async () => {
    // The quiet case for the refusal above. The invitation is consumed by the first
    // sign-in, so if that were the only way through, every second login would be denied.
    await seedInvitation("CASE-0042", "operator@example.test", "member");
    const first = await resolveInvitedUser(db, "operator@example.test");

    const second = await resolveInvitedUser(db, "operator@example.test");

    expect(second?.appUserId).toBe(first?.appUserId);
  });

  test("an address differing only in case is the same person", async () => {
    // Two app_user rows for one person is a session whose tenant list is mysteriously
    // empty, and `app_user.email` is UNIQUE on exact text.
    await seedInvitation("CASE-0042", "operator@example.test", "member");
    const invited = await resolveInvitedUser(db, "operator@example.test");

    const shouting = await resolveInvitedUser(db, "  Operator@Example.TEST  ");

    expect(shouting?.appUserId).toBe(invited?.appUserId);
  });
});

describe("resolving a session's address to its authorization identity", () => {
  test("a provisioned address resolves to its app_user id", async () => {
    await seedInvitation("CASE-0042", "operator@example.test", "member");
    const provisioned = await resolveInvitedUser(db, "operator@example.test");

    const found = await appUserForEmail(db, "operator@example.test");

    expect(found?.appUserId).toBe(provisioned?.appUserId);
  });

  test("an unknown address resolves to nothing and provisions nothing", async () => {
    // Read-only on purpose: if this created an app_user, deleting an account would not
    // revoke access, it would just delay it until the next request.
    expect(await appUserForEmail(db, "stranger@example.test")).toBeNull();

    const { rows } = await db.query("SELECT id FROM app.app_user");
    expect(rows).toHaveLength(0);
  });
});
