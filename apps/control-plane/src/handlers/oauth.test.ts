/**
 * The per-tenant consent, end to end through the HTTP route.
 *
 * Real PGlite, a real handshake table, and an in-memory worker that records what it was
 * asked. What is under test is almost entirely refusal: this route ends with a token minted
 * into a customer's Google account, so every check in front of it is the feature.
 */

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/style/noMagicNumbers: In a test the number IS the assertion. `expect(delayMs).toBe(5000)` says what the code must do; `expect(delayMs).toBe(EXPECTED_BACKOFF_MS)` says only that two names agree, and it can pass while both are wrong. Naming a fixture value also puts the expected result somewhere other than the line asserting it, which is the opposite of what .claude/rules/tests.md asks for. Source files get named constants; test files keep their literals.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { Hono } from "hono";

import { startConsent } from "../services/oauth.ts";
import { InMemoryWorkerClient } from "../services/workerClient.ts";
import { registerOAuthRoutes } from "./oauth.ts";

const TENANT = "CASE-0042";
const ADMIN = { userId: "", email: "ada@example.test" };
const MEMBER = { userId: "", email: "bo@example.test" };
const TOKEN_URL = "https://oauth2.googleapis.test/token";

let db: TestDatabase;
let worker: InMemoryWorkerClient;
/** What the token endpoint will answer. Set per test; no network, no mock. */
let tokenResponse: { status: number; body: unknown };

const ID_TOKEN = `header.${Buffer.from(
  JSON.stringify({ sub: "108134092834092834", email: "ops@acme.test" }),
).toString("base64url")}.signature`;

const google = {
  clientId: "ingest.apps.googleusercontent.test",
  clientSecret: "ingest-secret",
  publicUrl: "https://undercroft.test",
  authorizeUrl: "https://accounts.google.test/o/oauth2/v2/auth",
  tokenUrl: TOKEN_URL,
  // A real function standing in for the platform's fetch, not a spy: it answers from the
  // variable above and refuses anything it was not set up for.
  fetch: (url: string) => {
    if (url !== TOKEN_URL) {
      return Promise.reject(new Error(`unexpected fetch to ${url}`));
    }
    return Promise.resolve(
      new Response(JSON.stringify(tokenResponse.body), { status: tokenResponse.status }),
    );
  },
};

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  ADMIN.userId = await seedUser(ADMIN.email, "admin");
  MEMBER.userId = await seedUser(MEMBER.email, "member");
  // Backed by the database, so it has the side effect the real worker has: a stored
  // credential leaves a connected `ops.connection` row, which `app.connection_detail` has a
  // foreign key to.
  worker = new InMemoryWorkerClient().backedBy(db);
  tokenResponse = {
    status: 200,
    body: {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3599,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
      id_token: ID_TOKEN,
    },
  };
});

afterEach(async () => {
  await db.close();
});

async function seedUser(email: string, role: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [email],
  );
  const id = rows[0]?.id ?? "";
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    TENANT,
    id,
    role,
  ]);
  return id;
}

/** Build the app with a given signed-in caller. `null` is nobody signed in. */
function appFor(caller: { userId: string; email: string } | null): Hono {
  const app = new Hono();
  registerOAuthRoutes(app, {
    exec: db,
    google,
    worker,
    isAdminOf: async (tenantId, userId) => {
      const { rows } = await db.query<{ role: string }>(
        "SELECT role FROM app.tenant_member WHERE tenant_id = $1 AND user_id = $2",
        [tenantId, userId],
      );
      return rows[0]?.role === "admin";
    },
    resolveCaller: () => Promise.resolve(caller),
  });
  return app;
}

/** Start a real consent and return the `state` Google would hand back. */
async function beginConsent(source = "gmail"): Promise<string> {
  const started = await startConsent(
    { exec: db, google },
    { tenantId: TENANT, source, startedBy: ADMIN.userId },
  );
  if (!started.ok) {
    throw new Error("expected the consent to start");
  }
  return new URL(started.authorizeUrl).searchParams.get("state") ?? "";
}

function callback(app: Hono, query: Record<string, string>) {
  return app.request(`/oauth/google/callback?${new URLSearchParams(query).toString()}`);
}

describe("completing a consent", () => {
  it("a valid state and an admin stores the credential and goes to the scope picker", async () => {
    // The quiet side: every refusal below would be satisfied by a callback that refused
    // everything.
    const state = await beginConsent();

    const response = await callback(appFor(ADMIN), { state, code: "auth-code" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/tenants/CASE-0042/connect/gmail/scope");
    expect(worker.stored).toHaveLength(1);
    expect(worker.stored[0]?.credential.refreshToken).toBe("rt");
  });

  it("the account id sent to the worker is Google's sub, not the address", async () => {
    // `ops.connection.external_account_id` is readable by the BI role. An address there
    // would be a customer's mailbox on a dashboard.
    const state = await beginConsent();

    await callback(appFor(ADMIN), { state, code: "auth-code" });

    expect(worker.stored[0]?.externalAccountId).toBe("108134092834092834");
    expect(worker.stored[0]?.externalAccountId).not.toContain("@");
  });

  it("the address is recorded where BI cannot read it", async () => {
    const state = await beginConsent();

    await callback(appFor(ADMIN), { state, code: "auth-code" });

    const { rows } = await db.query<{ account_label: string }>(
      "SELECT account_label FROM app.connection_detail WHERE tenant_id = $1",
      [TENANT],
    );
    expect(rows[0]?.account_label).toBe("ops@acme.test");
  });

  it("an unknown state is refused and nothing is exchanged", async () => {
    const response = await callback(appFor(ADMIN), { state: "never-issued", code: "auth-code" });

    expect(response.headers.get("location")).toContain("connect=failed");
    expect(worker.stored).toHaveLength(0);
  });

  it("the same state cannot be used twice", async () => {
    // Single use is a property of one `DELETE ... RETURNING`, not of a read-then-delete
    // that leaves a window a replay can win.
    const state = await beginConsent();
    await callback(appFor(ADMIN), { state, code: "auth-code" });

    const replay = await callback(appFor(ADMIN), { state, code: "auth-code" });

    expect(replay.headers.get("location")).toContain("reason=bad-state");
    expect(worker.stored).toHaveLength(1);
  });

  it("a member of the tenant is refused: starting a flow is not a standing authorisation", async () => {
    // Minutes pass between start and callback, and a role can be withdrawn in them. The
    // check is re-asked at the moment of use.
    const state = await beginConsent();

    const response = await callback(appFor(MEMBER), { state, code: "auth-code" });

    expect(response.headers.get("location")).toContain("reason=not-admin");
    expect(worker.stored).toHaveLength(0);
  });

  it("nobody signed in is refused", async () => {
    const state = await beginConsent();

    const response = await callback(appFor(null), { state, code: "auth-code" });

    expect(response.headers.get("location")).toContain("reason=not-admin");
    expect(worker.stored).toHaveLength(0);
  });

  it("an admin who declined at Google is not shown an error", async () => {
    const response = await callback(appFor(ADMIN), { error: "access_denied", state: "x" });

    expect(response.headers.get("location")).toContain("reason=declined");
  });

  it("a refused code exchange stores nothing", async () => {
    const state = await beginConsent();
    tokenResponse = { status: 400, body: { error: "invalid_grant" } };

    const response = await callback(appFor(ADMIN), { state, code: "stale-code" });

    expect(response.headers.get("location")).toContain("reason=exchange-failed");
    expect(worker.stored).toHaveLength(0);
  });

  it("a worker that cannot seal leaves no half-made connection", async () => {
    const state = await beginConsent();
    worker.failing("unreachable");

    const response = await callback(appFor(ADMIN), { state, code: "auth-code" });

    expect(response.headers.get("location")).toContain("reason=worker-refused");
    const { rows } = await db.query("SELECT 1 FROM app.connection_detail");
    expect(rows).toHaveLength(0);
  });

  it("a consent that worked is written to the audit trail", async () => {
    const state = await beginConsent();

    await callback(appFor(ADMIN), { state, code: "auth-code" });

    const { rows } = await db.query<{ action: string; actor: string; detail: unknown }>(
      "SELECT action, actor, detail FROM ops.audit_log",
    );
    expect(rows[0]?.action).toBe("connection.connected");
    expect(rows[0]?.actor).toBe("ada@example.test");
    // The source and who, never the address: ops.audit_log has a different readership.
    expect(JSON.stringify(rows[0]?.detail)).not.toContain("ops@acme.test");
  });
});
