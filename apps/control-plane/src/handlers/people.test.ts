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

// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/style/noNonNullAssertion: Almost all of these are tests asserting on a fixture they created three lines earlier, which the ESLint config this replaced also exempted for the same reason. Biome's unsafe autofix for the rule deletes the `!` and leaves `string | undefined` flowing into a `string`, so it does not compile.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { DEFAULT_LOCALE, type Locale } from "@undercroft/core";
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
    sessionId: "s1",
    // These tests are about what a tenant `admin` may do. Platform authority is a different
    // axis, exercised in `authz.test.ts`; keeping it off here means every admin in this file
    // is an ordinary one.
    superadmin: false,
    locale,
    endSession: () => Promise.resolve(),
    notifyInvitation: () => Promise.resolve(true),
    startConsent: () => Promise.resolve({ ok: false as const, reason: "not-configured" as const }),
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
