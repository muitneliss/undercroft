/**
 * The authorization semantics, exercised through a real caller against PGlite.
 *
 * No HTTP and no mocks: the test builds a context and calls the router directly, so it
 * runs the actual middleware -- the 404-not-403 boundary, the role ranks -- against real
 * Postgres grants and rows.
 */

import { DEFAULT_LOCALE } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appRouter } from "./router.ts";
import type { Context, Role, SessionUser } from "./trpc.ts";

let db: TestDatabase;

async function seedUser(email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [email],
  );
  return rows[0]!.id;
}

async function seedMembership(tenantId: string, userId: string, role: Role): Promise<void> {
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1) ON CONFLICT DO NOTHING", [tenantId]);
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    tenantId,
    userId,
    role,
  ]);
}

function caller(user: SessionUser | null) {
  const ctx: Context = {
    exec: db,
    user,
    sessionId: "s1",
    // The product default, as a request with no `Accept-Language` would resolve to. These
    // tests assert which code a refusal carries, never its wording.
    locale: DEFAULT_LOCALE,
    endSession: () => Promise.resolve(),
    // No mail in an authorization test: these procedures are being checked for who may
    // call them, and a sender here would be a second thing under test.
    notifyInvitation: () => Promise.resolve(false),
    // No Google client and no worker, for the same reason. `startOAuth` then falls back to
    // the placeholder it has always returned, which is what these tests assert.
    startConsent: () => Promise.resolve({ ok: false as const }),
    worker: null,
    googlePicker: null,
  };
  return appRouter.createCaller(ctx);
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
  db = await createTestDatabase();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

describe("a non-member is told the tenant does not exist", () => {
  test("get on a tenant the caller cannot see is NOT_FOUND, not FORBIDDEN", async () => {
    // FORBIDDEN would confirm the tenant exists, turning this into a customer-list oracle.
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-secret')");
    const outsider = await seedUser("outsider@example.test");
    expect(
      await errorCode(() =>
        caller({ userId: outsider, email: "outsider@example.test" }).tenants.get({
          tenantId: "CASE-secret",
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  test("a member gets the tenant back", async () => {
    const user = await seedUser("member@example.test");
    await seedMembership("CASE-1", user, "member");
    const tenant = await caller({ userId: user, email: "member@example.test" }).tenants.get({
      tenantId: "CASE-1",
    });
    expect(tenant.id).toBe("CASE-1");
    expect(tenant.role).toBe("member");
  });
});

describe("role ranks gate privileged actions once membership is established", () => {
  test("a viewer calling startOAuth gets FORBIDDEN, because they know the tenant exists", async () => {
    const user = await seedUser("viewer@example.test");
    await seedMembership("CASE-1", user, "viewer");
    expect(
      await errorCode(() =>
        caller({ userId: user, email: "viewer@example.test" }).connections.startOAuth({
          tenantId: "CASE-1",
          source: "hubspot",
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  test("an admin may start an OAuth flow", async () => {
    const user = await seedUser("admin@example.test");
    await seedMembership("CASE-1", user, "admin");
    const result = await caller({
      userId: user,
      email: "admin@example.test",
    }).connections.startOAuth({
      tenantId: "CASE-1",
      source: "hubspot",
    });
    expect(result.authorizeUrl).toContain("/oauth/hubspot/");
  });

  test("a member cannot change what a connection reads", async () => {
    // Narrowing or widening a live grant is an admin's decision. A member may see the
    // schedule; they may not alter what a customer shares.
    const user = await seedUser("member@example.test");
    await seedMembership("CASE-1", user, "member");
    expect(
      await errorCode(() =>
        caller({ userId: user, email: "member@example.test" }).connections.setScope({
          tenantId: "CASE-1",
          source: "gmail",
          selection: { labels: [] },
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  test("an admin may change what a connection reads", async () => {
    const user = await seedUser("admin2@example.test");
    await seedMembership("CASE-1", user, "admin");
    await db.query(
      "INSERT INTO ops.connection (tenant_id, source, status) VALUES ('CASE-1','gmail','connected')",
    );

    const result = await caller({
      userId: user,
      email: "admin2@example.test",
    }).connections.setScope({
      tenantId: "CASE-1",
      source: "gmail",
      selection: { labels: [] },
    });

    expect(result).toEqual({ ok: true });
  });

  test("a member cannot end a grant", async () => {
    const user = await seedUser("member2@example.test");
    await seedMembership("CASE-1", user, "member");
    expect(
      await errorCode(() =>
        caller({ userId: user, email: "member2@example.test" }).connections.disconnect({
          tenantId: "CASE-1",
          source: "gmail",
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  test("browsing a scope with no worker configured says so rather than failing obscurely", async () => {
    // `ctx.worker` is null in these tests. A PRECONDITION_FAILED names the cause; letting it
    // through would surface as a network error that reads like a Google outage.
    const user = await seedUser("admin3@example.test");
    await seedMembership("CASE-1", user, "admin");
    expect(
      await errorCode(() =>
        caller({ userId: user, email: "admin3@example.test" }).connections.browseScope({
          tenantId: "CASE-1",
          source: "gmail",
        }),
      ),
    ).toBe("PRECONDITION_FAILED");
  });
});

describe("unauthenticated access", () => {
  test("session.me without a user is UNAUTHORIZED", async () => {
    expect(await errorCode(() => caller(null).session.me())).toBe("UNAUTHORIZED");
  });

  test("the list view shows only tenants the caller belongs to", async () => {
    const user = await seedUser("u@example.test");
    await seedMembership("CASE-1", user, "member");
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-other')");
    const tenants = await caller({ userId: user, email: "u@example.test" }).tenants.list();
    expect(tenants.map((t) => t.id)).toEqual(["CASE-1"]);
  });
});

describe("models.preview keeps money as a string", () => {
  test("a numeric column comes back as a string, never a float", async () => {
    const user = await seedUser("u@example.test");
    await seedMembership("CASE-1", user, "member");
    await db.exec("CREATE TABLE analytics.fct_demo (amount numeric(18,4))");
    await db.query("INSERT INTO analytics.fct_demo (amount) VALUES (8500.0001)");
    const result = await caller({ userId: user, email: "u@example.test" }).models.preview({
      tenantId: "CASE-1",
      table: "fct_demo",
    });
    expect(typeof (result.rows[0] as { amount: unknown }).amount).toBe("string");
  });
});
