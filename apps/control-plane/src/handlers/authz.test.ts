/**
 * The authorization semantics, exercised through a real caller against PGlite.
 *
 * No HTTP and no mocks: the test builds a context and calls the router directly, so it
 * runs the actual middleware -- the 404-not-403 boundary, the role ranks -- against real
 * Postgres grants and rows.
 */

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/style/noExcessiveLinesPerFile: One design document and one deploy client, each of which argues with itself across its length. Splitting at 300 lines would cut a single argument in half.

// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/style/noNonNullAssertion: Almost all of these are tests asserting on a fixture they created three lines earlier, which the ESLint config this replaced also exempted for the same reason. Biome's unsafe autofix for the rule deletes the `!` and leaves `string | undefined` flowing into a `string`, so it does not compile.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { DEFAULT_LOCALE } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
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

function caller(user: SessionUser | null, superadmin = false) {
  const ctx: Context = {
    exec: db,
    user,
    sessionId: "s1",
    // Defaulted off, so every test written before platform authority existed still asks the
    // question it was asking: what an ordinary member may do. A superadmin is opted into.
    superadmin,
    // The product default, as a request with no `Accept-Language` would resolve to. These
    // tests assert which code a refusal carries, never its wording.
    locale: DEFAULT_LOCALE,
    endSession: () => Promise.resolve(),
    // No mail in an authorization test: these procedures are being checked for who may
    // call them, and a sender here would be a second thing under test.
    notifyInvitation: () => Promise.resolve(false),
    // No Google client and no worker, for the same reason. `startOAuth` therefore refuses
    // every caller who gets past the role gate -- which is what makes PRECONDITION_FAILED
    // the proof of authorization here: it is the answer only a caller the gate ADMITTED can
    // receive.
    startConsent: () => Promise.resolve({ ok: false as const, reason: "not-configured" as const }),
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
  it("get on a tenant the caller cannot see is NOT_FOUND, not FORBIDDEN", async () => {
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

  it("a member gets the tenant back", async () => {
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
  it("a viewer calling startOAuth gets FORBIDDEN, because they know the tenant exists", async () => {
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

  it("an admin gets past the role gate on startOAuth", async () => {
    // PRECONDITION_FAILED, not a URL: this fixture configures no Google client, so the
    // furthest an admitted caller can get is the procedure telling them so. That is the
    // point -- the viewer above never reaches this answer, and the difference between the
    // two codes IS the authorization fact under test.
    //
    // It used to assert a `/oauth/hubspot/` URL, which the procedure fabricated for a
    // refusal it had no way to report. A test can only be as honest as the value it reads.
    const user = await seedUser("admin@example.test");
    await seedMembership("CASE-1", user, "admin");
    expect(
      await errorCode(() =>
        caller({ userId: user, email: "admin@example.test" }).connections.startOAuth({
          tenantId: "CASE-1",
          source: "hubspot",
        }),
      ),
    ).toBe("PRECONDITION_FAILED");
  });

  it("a member cannot change what a connection reads", async () => {
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

  it("an admin may change what a connection reads", async () => {
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

  it("a member cannot end a grant", async () => {
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

  it("browsing a scope with no worker configured says so rather than failing obscurely", async () => {
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
  it("session.me without a user is UNAUTHORIZED", async () => {
    expect(await errorCode(() => caller(null).session.me())).toBe("UNAUTHORIZED");
  });

  it("the list view shows only tenants the caller belongs to", async () => {
    const user = await seedUser("u@example.test");
    await seedMembership("CASE-1", user, "member");
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-other')");
    const tenants = await caller({ userId: user, email: "u@example.test" }).tenants.list();
    expect(tenants.map((t) => t.id)).toEqual(["CASE-1"]);
  });
});

describe("models.preview keeps money as a string", () => {
  it("a numeric column comes back as a string, never a float", async () => {
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

/**
 * Platform authority: what `UNDERCROFT_SUPERADMINS` buys, and what it must not.
 *
 * Each of these is paired with the same call made by a caller who is NOT a superadmin, so
 * a bug that granted authority unconditionally -- the failure mode that matters, because it
 * is silent -- cannot pass. `.claude/rules/tests.md`: a guard needs two tests.
 */
describe("a superadmin holds admin in every tenant", () => {
  it("reaches a tenant they are not a member of", async () => {
    const user = await seedUser("root@example.test");
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");

    const tenant = await caller({ userId: user, email: "root@example.test" }, true).tenants.get({
      tenantId: "CASE-1",
    });

    expect(tenant.role).toBe("admin");
  });

  it("the same caller without platform authority is told the tenant does not exist", async () => {
    const user = await seedUser("root@example.test");
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");

    expect(
      await errorCode(() =>
        caller({ userId: user, email: "root@example.test" }).tenants.get({ tenantId: "CASE-1" }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("a tenant that does not exist is still NOT_FOUND for a superadmin", async () => {
    // Otherwise every tenant-scoped procedure would run against a customer that is not
    // there, and report an empty connection list rather than a 404 -- plausible and wrong.
    const user = await seedUser("root@example.test");

    expect(
      await errorCode(() =>
        caller({ userId: user, email: "root@example.test" }, true).tenants.get({
          tenantId: "CASE-nonexistent",
        }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("a superadmin can act in a tenant, not only see it", () => {
  it("may invite to a tenant they have no membership in", async () => {
    // `people.invite` is requireRole("admin"). Platform authority has to satisfy it, or a
    // superadmin can see a customer and do nothing about who may reach it.
    const user = await seedUser("root@example.test");
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");

    const result = await caller({ userId: user, email: "root@example.test" }, true).people.invite({
      tenantId: "CASE-1",
      email: "new@example.test",
      role: "viewer",
    });

    expect(result.email).toBe("new@example.test");
  });

  it("the list view shows every tenant, including ones with no membership", async () => {
    const user = await seedUser("root@example.test");
    await seedMembership("CASE-1", user, "member");
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-other')");

    const tenants = await caller({ userId: user, email: "root@example.test" }, true).tenants.list();

    // `admin` for both, matching what `tenants.get` grants above: the list and the page must
    // not disagree about what may be done there.
    expect(tenants.map((tenant) => `${tenant.id}:${tenant.role}`)).toEqual([
      "CASE-1:admin",
      "CASE-other:admin",
    ]);
  });
});

describe("creating a customer is platform authority, not a tenant role", () => {
  it("a superadmin creates one and it appears in the list", async () => {
    const user = await seedUser("root@example.test");

    const created = await caller({ userId: user, email: "root@example.test" }, true).tenants.create(
      { tenantId: "CASE-0001", displayName: "Acme" },
    );

    expect(created.displayName).toBe("Acme");
    const tenants = await caller({ userId: user, email: "root@example.test" }, true).tenants.list();
    expect(tenants.map((tenant) => tenant.id)).toEqual(["CASE-0001"]);
  });

  it("a tenant admin cannot, however senior in their own customer", async () => {
    // The point of the pairing: `admin` is the top of ROLE_RANK and still is not this.
    const user = await seedUser("admin@example.test");
    await seedMembership("CASE-1", user, "admin");

    expect(
      await errorCode(() =>
        caller({ userId: user, email: "admin@example.test" }).tenants.create({
          tenantId: "CASE-0002",
          displayName: "",
        }),
      ),
    ).toBe("FORBIDDEN");
  });
});

describe("a customer reference is refused rather than reinterpreted", () => {
  it("a reference already in use is a CONFLICT, and does not rename the existing customer", async () => {
    const user = await seedUser("root@example.test");
    const root = caller({ userId: user, email: "root@example.test" }, true);
    await root.tenants.create({ tenantId: "CASE-0001", displayName: "First" });

    expect(
      await errorCode(() => root.tenants.create({ tenantId: "CASE-0001", displayName: "Second" })),
    ).toBe("CONFLICT");

    const tenants = await root.tenants.list();
    expect(tenants[0]?.displayName).toBe("First");
  });

  it("an empty display name falls back to the reference rather than a blank row", async () => {
    const user = await seedUser("root@example.test");
    const root = caller({ userId: user, email: "root@example.test" }, true);

    const created = await root.tenants.create({ tenantId: "CASE-0003", displayName: "" });

    expect(created.displayName).toBe("CASE-0003");
  });

  it("a reference with a space in it is refused before it reaches the database", async () => {
    // It becomes an S3 key prefix in the raw lake, which cannot be renamed afterwards.
    const user = await seedUser("root@example.test");

    expect(
      await errorCode(() =>
        caller({ userId: user, email: "root@example.test" }, true).tenants.create({
          tenantId: "CASE 0001",
          displayName: "",
        }),
      ),
    ).toBe("BAD_REQUEST");
  });
});
