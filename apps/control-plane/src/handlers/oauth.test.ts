/**
 * The per-tenant consent, end to end through the HTTP route.
 *
 * Real PGlite, a real handshake table, and an in-memory worker that records what it was
 * asked. What is under test is almost entirely refusal: this route ends with a token minted
 * into a customer's Google account, so every check in front of it is the feature.
 */

import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
  if (!started.ok) throw new Error("expected the consent to start");
  return new URL(started.authorizeUrl).searchParams.get("state") ?? "";
}

function callback(app: Hono, query: Record<string, string>) {
  return app.request(`/oauth/google/callback?${new URLSearchParams(query).toString()}`);
}

describe("starting a consent", () => {
  test("the authorize URL asks for offline access and forces the consent screen", async () => {
    // Both are required. Without `access_type=offline` Google issues no refresh token at
    // all; without `prompt=consent` it issues one only on the very first consent, so a
    // customer who reconnects gets a credential that dies at the next expiry and cannot be
    // refreshed -- hours later, far from the cause.
    const started = await startConsent(
      { exec: db, google },
      { tenantId: TENANT, source: "gmail", startedBy: ADMIN.userId },
    );
    if (!started.ok) throw new Error("expected the consent to start");

    const params = new URL(started.authorizeUrl).searchParams;
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("redirect_uri")).toBe("https://undercroft.test/oauth/google/callback");
  });

  test("drive asks for drive.file, never drive.readonly", async () => {
    // drive.file reaches only what the admin picked in the Picker, so "No other folder is
    // read" is enforced by Google. It is also not a restricted scope, so it carries no
    // annual CASA assessment.
    const started = await startConsent(
      { exec: db, google },
      { tenantId: TENANT, source: "drive", startedBy: ADMIN.userId },
    );
    if (!started.ok) throw new Error("expected the consent to start");

    const scope = new URL(started.authorizeUrl).searchParams.get("scope") ?? "";
    expect(scope).toContain("https://www.googleapis.com/auth/drive.file");
    expect(scope).not.toContain("drive.readonly");
  });

  test("the state is stored as a digest, never in the clear", async () => {
    const state = await beginConsent();

    const { rows } = await db.query<{ state_sha256: string }>(
      "SELECT state_sha256 FROM app.oauth_handshake",
    );
    expect(rows[0]?.state_sha256).not.toBe(state);
    expect(rows[0]?.state_sha256).toHaveLength(64);
  });

  test("an unconfigured ingest client refuses rather than building a broken URL", async () => {
    const started = await startConsent(
      { exec: db },
      {
        tenantId: TENANT,
        source: "gmail",
        startedBy: ADMIN.userId,
      },
    );

    expect(started).toEqual({ ok: false, reason: "not-configured" });
  });

  test("an unsupported source is refused", async () => {
    const started = await startConsent(
      { exec: db, google },
      { tenantId: TENANT, source: "hubspot", startedBy: ADMIN.userId },
    );

    expect(started).toEqual({ ok: false, reason: "unsupported-source" });
  });
});

describe("completing a consent", () => {
  test("a valid state and an admin stores the credential and goes to the scope picker", async () => {
    // The quiet side: every refusal below would be satisfied by a callback that refused
    // everything.
    const state = await beginConsent();

    const response = await callback(appFor(ADMIN), { state, code: "auth-code" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/tenants/CASE-0042/connect/gmail/scope");
    expect(worker.stored).toHaveLength(1);
    expect(worker.stored[0]?.credential.refreshToken).toBe("rt");
  });

  test("the account id sent to the worker is Google's sub, not the address", async () => {
    // `ops.connection.external_account_id` is readable by the BI role. An address there
    // would be a customer's mailbox on a dashboard.
    const state = await beginConsent();

    await callback(appFor(ADMIN), { state, code: "auth-code" });

    expect(worker.stored[0]?.externalAccountId).toBe("108134092834092834");
    expect(worker.stored[0]?.externalAccountId).not.toContain("@");
  });

  test("the address is recorded where BI cannot read it", async () => {
    const state = await beginConsent();

    await callback(appFor(ADMIN), { state, code: "auth-code" });

    const { rows } = await db.query<{ account_label: string }>(
      "SELECT account_label FROM app.connection_detail WHERE tenant_id = $1",
      [TENANT],
    );
    expect(rows[0]?.account_label).toBe("ops@acme.test");
  });

  test("an unknown state is refused and nothing is exchanged", async () => {
    const response = await callback(appFor(ADMIN), { state: "never-issued", code: "auth-code" });

    expect(response.headers.get("location")).toContain("connect=failed");
    expect(worker.stored).toHaveLength(0);
  });

  test("the same state cannot be used twice", async () => {
    // Single use is a property of one `DELETE ... RETURNING`, not of a read-then-delete
    // that leaves a window a replay can win.
    const state = await beginConsent();
    await callback(appFor(ADMIN), { state, code: "auth-code" });

    const replay = await callback(appFor(ADMIN), { state, code: "auth-code" });

    expect(replay.headers.get("location")).toContain("reason=bad-state");
    expect(worker.stored).toHaveLength(1);
  });

  test("a member of the tenant is refused: starting a flow is not a standing authorisation", async () => {
    // Minutes pass between start and callback, and a role can be withdrawn in them. The
    // check is re-asked at the moment of use.
    const state = await beginConsent();

    const response = await callback(appFor(MEMBER), { state, code: "auth-code" });

    expect(response.headers.get("location")).toContain("reason=not-admin");
    expect(worker.stored).toHaveLength(0);
  });

  test("nobody signed in is refused", async () => {
    const state = await beginConsent();

    const response = await callback(appFor(null), { state, code: "auth-code" });

    expect(response.headers.get("location")).toContain("reason=not-admin");
    expect(worker.stored).toHaveLength(0);
  });

  test("an admin who declined at Google is not shown an error", async () => {
    const response = await callback(appFor(ADMIN), { error: "access_denied", state: "x" });

    expect(response.headers.get("location")).toContain("reason=declined");
  });

  test("a refused code exchange stores nothing", async () => {
    const state = await beginConsent();
    tokenResponse = { status: 400, body: { error: "invalid_grant" } };

    const response = await callback(appFor(ADMIN), { state, code: "stale-code" });

    expect(response.headers.get("location")).toContain("reason=exchange-failed");
    expect(worker.stored).toHaveLength(0);
  });

  test("a worker that cannot seal leaves no half-made connection", async () => {
    const state = await beginConsent();
    worker.failing("unreachable");

    const response = await callback(appFor(ADMIN), { state, code: "auth-code" });

    expect(response.headers.get("location")).toContain("reason=worker-refused");
    const { rows } = await db.query("SELECT 1 FROM app.connection_detail");
    expect(rows).toHaveLength(0);
  });

  test("a consent that worked is written to the audit trail", async () => {
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
