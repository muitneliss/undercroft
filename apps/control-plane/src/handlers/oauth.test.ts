/**
 * The per-tenant consent, end to end through the HTTP route.
 *
 * Real PGlite, a real handshake table, and an in-memory worker that records what it was
 * asked. What is under test is almost entirely refusal: this route ends with a token minted
 * into a customer's Google account, so every check in front of it is the feature.
 */

// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { Hono } from "hono";

import { isAdminIn } from "../services/authz.ts";
import { startConsent } from "../services/oauth.ts";
import { NO_SUPERADMINS } from "../services/superadmin.ts";
import { InMemoryWorkerClient } from "../services/workerClient.ts";
import { registerOAuthRoutes } from "./oauth.ts";

const TENANT = "CASE-0042";
const ADMIN = { userId: "", email: "ada@example.test" };
const MEMBER = { userId: "", email: "bo@example.test" };
/** Named in UNDERCROFT_SUPERADMINS, and a member of nothing -- which is the whole point. */
const SUPERADMIN = { userId: "", email: "root@example.test" };
const SUPERADMINS: ReadonlySet<string> = new Set([SUPERADMIN.email]);
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
  // No `tenant_member` row, deliberately: ADR 0013 provisions a superadmin with none, and a
  // fixture that quietly gave them one would test a person who does not exist.
  SUPERADMIN.userId = await seedAppUser(SUPERADMIN.email);
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

async function seedAppUser(email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [email],
  );
  return rows[0]?.id ?? "";
}

async function seedUser(email: string, role: string): Promise<string> {
  const id = await seedAppUser(email);
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    TENANT,
    id,
    role,
  ]);
  return id;
}

/**
 * Build the app with a given signed-in caller. `null` is nobody signed in.
 *
 * `hasAdminAuthority` is the REAL policy, not a lookup written here. The first version of
 * this helper ran its own `SELECT role FROM app.tenant_member`, which happened to be what
 * the wiring in `server.ts` also did -- so the suite agreed with production about a rule
 * neither of them had right, and stayed green while a superadmin could not finish a consent.
 * A test that re-implements the thing under test can only ever confirm itself.
 */
function appFor(
  caller: { userId: string; email: string } | null,
  superadmins: ReadonlySet<string> = NO_SUPERADMINS,
): Hono {
  const app = new Hono();
  registerOAuthRoutes(app, {
    exec: db,
    google,
    worker,
    hasAdminAuthority: (tenantId, who) => isAdminIn(db, superadmins, { tenantId, ...who }),
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

  it("a consent that withheld the scope it asked for seals nothing", async () => {
    // Google's screen lets a person untick one permission and press Allow anyway, and what
    // comes back is a perfectly valid token for a grant that can read nothing. Sealed, it
    // becomes a `connected` card whose every call is a 403 -- which is what `case-001` was,
    // and the first anyone heard of it was "the processing service is not responding".
    tokenResponse = {
      status: 200,
      body: {
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3599,
        scope: "openid https://www.googleapis.com/auth/userinfo.email",
        id_token: ID_TOKEN,
      },
    };
    const state = await beginConsent();

    const response = await callback(appFor(ADMIN), { state, code: "auth-code" });

    expect(response.headers.get("location")).toContain("reason=scope-declined");
    expect(worker.stored).toHaveLength(0);
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

  it("a superadmin with no membership completes the consent", async () => {
    // The bug this pins: `server.ts` asked `roleFor`, a `tenant_member` lookup, while the
    // button that starts the flow asked `authorityIn`. So the platform administrator -- the
    // one person who can set a fresh deployment up, and who by design is a member of nothing
    // -- got all the way through Google's dialog and was then refused `not-admin`.
    const state = await beginConsent();

    const response = await callback(appFor(SUPERADMIN, SUPERADMINS), {
      state,
      code: "auth-code",
    });

    expect(response.headers.get("location")).toBe("/tenants/CASE-0042/connect/gmail/scope");
    expect(worker.stored).toHaveLength(1);
  });

  it("the same address is refused when it is not on the superadmin list", async () => {
    // The quiet half of the guard above. Platform authority comes from the environment, so
    // the identical caller with an empty list must get nowhere -- otherwise the test above
    // would pass against code that simply stopped checking.
    const state = await beginConsent();

    const response = await callback(appFor(SUPERADMIN, NO_SUPERADMINS), {
      state,
      code: "auth-code",
    });

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
