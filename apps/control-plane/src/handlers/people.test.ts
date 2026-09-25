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

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { DEFAULT_LOCALE, type Locale } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { resolveInvitedUser } from "../services/invite.ts";
import { appRouter } from "./router.ts";
import type { Context, Role, SessionUser } from "./trpc.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
  // Seeded as the superuser; from here on every statement runs as the control plane does.
  await db.become("undercroft_app");
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

function caller(user: SessionUser, locale: Locale = DEFAULT_LOCALE) {
  const ctx: Context = {
    exec: db,
    user,
    credentialId: "s1",
    via: "session",
    grant: "write",
    // These tests are about what a tenant `admin` may do. Platform authority is a different
    // axis, exercised in `authz.test.ts`; keeping it off here means every admin in this file
    // is an ordinary one.
    superadmin: false,
    locale,
    endSession: () => Promise.resolve(),
    apps: null,
    notifyInvitation: () => Promise.resolve(true),
    startConsent: () =>
      Promise.resolve({
        ok: false as const,
        reason: "not-configured" as const,
        provider: "google" as const,
      }),
    worker: null,
    googlePicker: null,
  };
  return appRouter.createCaller(ctx);
}

/** An admin of CASE-0042, which is who most of these tests act as. */
async function admin(locale: Locale = DEFAULT_LOCALE) {
  const userId = await seedMember("boss@example.test", "admin");
  return caller({ userId, email: "boss@example.test" }, locale);
}

async function errorMessage(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof TRPCError)) {
      throw error;
    }
    return error.message;
  }
  throw new Error("expected a refusal, got a result");
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
  it("a member cannot invite", async () => {
    // The firing case. An invitation grants a role inside a customer's tenant, and the
    // buttons behind that role mint OAuth tokens into their accounting system.
    const userId = await seedMember("hand@example.test", "member");
    const api = caller({ userId, email: "hand@example.test" });

    const code = await errorCode(() =>
      api.people.invite({ tenantId: "CASE-0042", email: "new@example.test", role: "viewer" }),
    );

    expect(code).toBe("FORBIDDEN");
  });

  it("an admin can invite", async () => {
    const api = await admin();

    const result = await api.people.invite({
      tenantId: "CASE-0042",
      email: "new@example.test",
      role: "viewer",
    });

    expect(result.email).toBe("new@example.test");
  });

  it("a non-member is told the tenant does not exist", async () => {
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
  it("inviting an address lets it sign in, with the role it was invited as", async () => {
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

  it("an address that was never invited is still refused", async () => {
    // The quiet side: issuing one invitation must not open the door generally.
    const api = await admin();
    await api.people.invite({
      tenantId: "CASE-0042",
      email: "invited@example.test",
      role: "member",
    });

    expect(await resolveInvitedUser(db, "stranger@example.test")).toBeNull();
  });

  it("an address invited in mixed case can sign in as itself", async () => {
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
  it("re-inviting refreshes the invitation rather than adding a second", async () => {
    // Two open invitations for one address would both be redeemed at first sign-in, which
    // is a confusing way to grant a single membership.
    const api = await admin();
    await api.people.invite({ tenantId: "CASE-0042", email: "new@example.test", role: "viewer" });
    await api.people.invite({ tenantId: "CASE-0042", email: "new@example.test", role: "admin" });

    const open = await api.people.invitations({ tenantId: "CASE-0042" });
    expect(open.filter((i) => i.status === "pending")).toHaveLength(1);
    expect(open[0]?.role).toBe("admin");
  });

  it("inviting someone who already has access is refused, not duplicated", async () => {
    const api = await admin();
    await seedMember("hand@example.test", "member");

    const code = await errorCode(() =>
      api.people.invite({ tenantId: "CASE-0042", email: "hand@example.test", role: "admin" }),
    );

    expect(code).toBe("CONFLICT");
  });

  it("the refusal is worded in the language the request asked for", async () => {
    // This message is rendered verbatim by `People.tsx`. If the router ever stops reading
    // `ctx.locale`, a Vietnamese admin gets one English sentence on the page -- and it
    // appears precisely when something has gone wrong, which is the worst moment for it.
    await seedMember("hand@example.test", "member");
    const invite = { tenantId: "CASE-0042", email: "hand@example.test", role: "admin" as const };

    const api = await admin("vi");
    const vietnamese = await errorMessage(() => api.people.invite(invite));

    expect(vietnamese).toContain("đã có quyền truy cập");
    expect(vietnamese).toContain("hand@example.test");
  });

  it("the same refusal in English, for an auditor who asked for it", async () => {
    // The guard's other side. One language asserted alone passes against a router that
    // ignores the locale and answers in that language always.
    await seedMember("hand@example.test", "member");
    const api = await admin("en");

    const english = await errorMessage(() =>
      api.people.invite({ tenantId: "CASE-0042", email: "hand@example.test", role: "admin" }),
    );

    expect(english).toContain("already has access as member");
  });
});

describe("an invitation can be withdrawn before it is used", () => {
  it("revoking an open invitation stops it being accepted", async () => {
    const api = await admin();
    const invited = await api.people.invite({
      tenantId: "CASE-0042",
      email: "new@example.test",
      role: "viewer",
    });

    await api.people.revokeInvitation({ tenantId: "CASE-0042", id: invited.id });

    expect(await resolveInvitedUser(db, "new@example.test")).toBeNull();
  });

  it("an admin of one tenant cannot revoke another tenant's invitation", async () => {
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

describe("an admin can change or end an existing member's access", () => {
  it("changing a member's role is what the roster then reports", async () => {
    // A mis-clicked invitation: meant as viewer, accepted as admin. Before #168 this was
    // permanent the moment it was accepted.
    const api = await admin();
    await seedMember("hand@example.test", "admin");

    const changed = await api.people.setRole({
      tenantId: "CASE-0042",
      email: "hand@example.test",
      role: "viewer",
    });

    expect(changed.previousRole).toBe("admin");
    const members = await api.people.members({ tenantId: "CASE-0042" });
    expect(members.find((m) => m.email === "hand@example.test")?.role).toBe("viewer");
  });

  it("a removed member is no longer listed", async () => {
    const api = await admin();
    await seedMember("hand@example.test", "member");

    await api.people.removeMember({ tenantId: "CASE-0042", email: "hand@example.test" });

    const members = await api.people.members({ tenantId: "CASE-0042" });
    expect(members.map((m) => m.email)).toEqual(["boss@example.test"]);
  });

  it("a member removed while signed in is refused on their very next request", async () => {
    // The session outlives the membership. Authority must not.
    const api = await admin();
    const userId = await seedMember("leaver@example.test", "admin");
    const leaver = caller({ userId, email: "leaver@example.test" });
    await leaver.people.members({ tenantId: "CASE-0042" });

    await api.people.removeMember({ tenantId: "CASE-0042", email: "leaver@example.test" });

    expect(await errorCode(() => leaver.people.members({ tenantId: "CASE-0042" }))).toBe(
      "NOT_FOUND",
    );
  });

  it("each change leaves an audit row saying who did it, to whom, and from what", async () => {
    const api = await admin();
    await seedMember("hand@example.test", "admin");
    await seedMember("gone@example.test", "viewer");

    await api.people.setRole({ tenantId: "CASE-0042", email: "hand@example.test", role: "member" });
    await api.people.removeMember({ tenantId: "CASE-0042", email: "gone@example.test" });

    const { rows } = await db.asSuperuser((tx) =>
      tx.query<{ actor: string; action: string; detail: unknown }>(
        "SELECT actor, action, detail FROM ops.audit_log WHERE tenant_id = $1 ORDER BY id",
        ["CASE-0042"],
      ),
    );
    expect(rows).toEqual([
      {
        actor: "boss@example.test",
        action: "people.setRole",
        detail: { email: "hand@example.test", role: "member", previousRole: "admin" },
      },
      {
        actor: "boss@example.test",
        action: "people.remove",
        detail: { email: "gone@example.test", previousRole: "viewer" },
      },
    ]);
  });

  it("an address with no access here is reported as not found, not silently accepted", async () => {
    const api = await admin();

    const code = await errorCode(() =>
      api.people.removeMember({ tenantId: "CASE-0042", email: "nobody@example.test" }),
    );

    expect(code).toBe("NOT_FOUND");
  });
});

describe("a customer is never left without an admin", () => {
  it("the only admin cannot lower their own role, and is told why", async () => {
    const api = await admin();

    const refusal = await errorMessage(() =>
      api.people.setRole({ tenantId: "CASE-0042", email: "boss@example.test", role: "member" }),
    );

    expect(refusal).toContain("boss@example.test");
    const members = await api.people.members({ tenantId: "CASE-0042" });
    expect(members).toEqual([
      { userId: expect.any(String), email: "boss@example.test", role: "admin" },
    ]);
  });

  it("the only admin cannot be removed", async () => {
    const api = await admin();

    const code = await errorCode(() =>
      api.people.removeMember({ tenantId: "CASE-0042", email: "boss@example.test" }),
    );

    expect(code).toBe("CONFLICT");
    const members = await api.people.members({ tenantId: "CASE-0042" });
    expect(members.map((m) => m.email)).toEqual(["boss@example.test"]);
  });

  it("an admin may step down or leave while another admin remains", async () => {
    // The guard's quiet side, and the decision on #168's open question: only the LAST admin
    // is protected, so an admin leaving a customer does not need a colleague to do it.
    const api = await admin();
    const deputyId = await seedMember("deputy@example.test", "admin");
    const deputy = caller({ userId: deputyId, email: "deputy@example.test" });

    await api.people.setRole({ tenantId: "CASE-0042", email: "boss@example.test", role: "viewer" });
    await deputy.people.removeMember({ tenantId: "CASE-0042", email: "boss@example.test" });

    const members = await deputy.people.members({ tenantId: "CASE-0042" });
    expect(members.map((m) => [m.email, m.role])).toEqual([["deputy@example.test", "admin"]]);
  });
});

describe("only an admin of this customer may change or end access", () => {
  it("a viewer and a member are both refused", async () => {
    await admin();
    const target = { tenantId: "CASE-0042", email: "boss@example.test" };

    for (const role of ["viewer", "member"] as const) {
      const email = `${role}@example.test`;
      const api = caller({ userId: await seedMember(email, role), email });
      expect(await errorCode(() => api.people.setRole({ ...target, role: "viewer" }))).toBe(
        "FORBIDDEN",
      );
      expect(await errorCode(() => api.people.removeMember(target))).toBe("FORBIDDEN");
    }
  });

  it("an admin of another customer cannot reach this customer's members", async () => {
    // The scoping guard. The statement is keyed by the caller's tenant, so naming their own
    // tenant finds nobody, and naming this one finds that they are not a member of it.
    const api = await admin();
    await seedMember("hand@example.test", "member");
    const farId = await seedMember("far@example.test", "admin", "CASE-0043");
    const far = caller({ userId: farId, email: "far@example.test" });

    const own = await errorCode(() =>
      far.people.removeMember({ tenantId: "CASE-0043", email: "hand@example.test" }),
    );
    const theirs = await errorCode(() =>
      far.people.removeMember({ tenantId: "CASE-0042", email: "hand@example.test" }),
    );

    expect([own, theirs]).toEqual(["NOT_FOUND", "NOT_FOUND"]);
    const members = await api.people.members({ tenantId: "CASE-0042" });
    expect(members.map((m) => m.email)).toContain("hand@example.test");
  });
});

describe("the roster says who has access", () => {
  it("members are listed with their roles", async () => {
    const api = await admin();
    await seedMember("hand@example.test", "viewer");

    const members = await api.people.members({ tenantId: "CASE-0042" });

    expect(members).toEqual([
      { userId: expect.any(String), email: "boss@example.test", role: "admin" },
      { userId: expect.any(String), email: "hand@example.test", role: "viewer" },
    ]);
  });
});
