/**
 * Starting a per-tenant consent: what the authorize URL asks Google for.
 *
 * Split from `oauth.test.ts`, which covers the other half -- what happens when Google sends
 * the browser back. Two halves, two files: the parameters on the way out and the checks on
 * the way in fail for different reasons and are read at different times.
 */

import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { startConsent } from "../services/oauth.ts";

const TENANT = "CASE-0042";
const ADMIN = { userId: "", email: "ada@example.test" };
const TOKEN_URL = "https://oauth2.googleapis.test/token";

let db: TestDatabase;
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
  await db.become("undercroft_app");
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

describe("starting a consent", () => {
  it("the authorize URL asks for offline access and forces the consent screen", async () => {
    // Both are required. Without `access_type=offline` Google issues no refresh token at
    // all; without `prompt=consent` it issues one only on the very first consent, so a
    // customer who reconnects gets a credential that dies at the next expiry and cannot be
    // refreshed -- hours later, far from the cause.
    const started = await startConsent(
      { exec: db, google },
      { tenantId: TENANT, source: "gmail", startedBy: ADMIN.userId },
    );
    if (!started.ok) {
      throw new Error("expected the consent to start");
    }

    const params = new URL(started.authorizeUrl).searchParams;
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("redirect_uri")).toBe("https://undercroft.test/oauth/google/callback");
  });

  it("drive asks for drive.file, never drive.readonly", async () => {
    // drive.file reaches only what the admin picked in the Picker, so "No other folder is
    // read" is enforced by Google. It is also not a restricted scope, so it carries no
    // annual CASA assessment.
    const started = await startConsent(
      { exec: db, google },
      { tenantId: TENANT, source: "drive", startedBy: ADMIN.userId },
    );
    if (!started.ok) {
      throw new Error("expected the consent to start");
    }

    const scope = new URL(started.authorizeUrl).searchParams.get("scope") ?? "";
    expect(scope).toContain("https://www.googleapis.com/auth/drive.file");
    expect(scope).not.toContain("drive.readonly");
  });

  it("the state is stored as a digest, never in the clear", async () => {
    const state = await beginConsent();

    const { rows } = await db.query<{ state_sha256: string }>(
      "SELECT state_sha256 FROM app.oauth_handshake",
    );
    expect(rows[0]?.state_sha256).not.toBe(state);
    expect(rows[0]?.state_sha256).toHaveLength(64);
  });

  it("an unconfigured ingest client refuses rather than building a broken URL", async () => {
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

  it("an unsupported source is refused", async () => {
    const started = await startConsent(
      { exec: db, google },
      { tenantId: TENANT, source: "hubspot", startedBy: ADMIN.userId },
    );

    expect(started).toEqual({ ok: false, reason: "unsupported-source" });
  });

  it("xero goes to Xero's authorize endpoint, with its own callback and no PKCE", async () => {
    // A confidential client with a secret: Xero takes it in a Basic header at the token
    // endpoint and reserves PKCE for clients that have none. `offline_access` is what makes
    // it issue a refresh token at all.
    const xero = {
      clientId: "xero-client",
      clientSecret: "xero-secret",
      publicUrl: "https://undercroft.test",
    };
    const started = await startConsent(
      { exec: db, google, xero },
      { tenantId: TENANT, source: "xero", startedBy: ADMIN.userId },
    );
    if (!started.ok) {
      throw new Error("expected the consent to start");
    }

    const url = new URL(started.authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://login.xero.com/identity/connect/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://undercroft.test/oauth/xero/callback",
    );
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("code_challenge")).toBeNull();
    expect(url.searchParams.get("client_id")).toBe("xero-client");
  });

  it("xero with no Xero client configured is refused, even with Google configured", async () => {
    const started = await startConsent(
      { exec: db, google },
      { tenantId: TENANT, source: "xero", startedBy: ADMIN.userId },
    );

    expect(started).toEqual({ ok: false, reason: "not-configured" });
  });
});
