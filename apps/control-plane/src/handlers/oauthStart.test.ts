/**
 * Starting a per-tenant consent: what the authorize URL asks the provider for, and what a
 * consent that cannot start says.
 *
 * Split from `oauth.test.ts`, which covers the other half -- what happens when Google sends
 * the browser back. Two halves, two files: the parameters on the way out and the checks on
 * the way in fail for different reasons and are read at different times.
 */

import { TRPCError } from "@trpc/server";
import { LOCALES, type Locale } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { startConsent } from "../services/oauth.ts";
import { appRouter } from "./router.ts";
import type { Context } from "./trpc.ts";

const TENANT = "CASE-0042";
const ADMIN = { userId: "", email: "ada@example.test" };

let db: TestDatabase;

/**
 * No token endpoint and no `fetch`: starting a consent only builds a URL and writes a
 * handshake row. The exchange is the callback's, in `oauth.test.ts`.
 */
const google = {
  clientId: "ingest.apps.googleusercontent.test",
  clientSecret: "ingest-secret",
  publicUrl: "https://undercroft.test",
  authorizeUrl: "https://accounts.google.test/o/oauth2/v2/auth",
};

/** For the refusals, which are decided before any statement runs: a query here fails loudly. */
const noDatabase: SqlExecutor = {
  query: () => Promise.reject(new Error("a refused consent must not touch the database")),
  exec: () => Promise.reject(new Error("a refused consent must not touch the database")),
};

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
  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
    ADMIN.userId = await seedUser(ADMIN.email, "admin");
    await db.become("undercroft_app");
  });

  afterEach(async () => {
    await db.close();
  });

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

  it("drive asks for drive.readonly, never drive.file", async () => {
    // Under drive.file a folder picked in Google's Picker does not grant the files already in
    // it, so a folder pick could never be read: the run listed nothing and closed green with
    // landed 0 (issue 178). drive.readonly is what reads a picked folder; the promise that no
    // other folder is read is then the collector's query to keep. ADR 0047, superseding the
    // drive.file half of ADR 0016.
    const started = await startConsent(
      { exec: db, google },
      { tenantId: TENANT, source: "drive", startedBy: ADMIN.userId },
    );
    if (!started.ok) {
      throw new Error("expected the consent to start");
    }

    const scope = new URL(started.authorizeUrl).searchParams.get("scope") ?? "";
    expect(scope.split(" ")).toContain("https://www.googleapis.com/auth/drive.readonly");
    expect(scope).not.toContain("drive.file");
  });

  it("the state is stored as a digest, never in the clear", async () => {
    const state = await beginConsent();

    const { rows } = await db.query<{ state_sha256: string }>(
      "SELECT state_sha256 FROM app.oauth_handshake",
    );
    expect(rows[0]?.state_sha256).not.toBe(state);
    expect(rows[0]?.state_sha256).toHaveLength(64);
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
});

describe("a consent that cannot start is refused before anything is written", () => {
  it("an unconfigured ingest client refuses rather than building a broken URL", async () => {
    const started = await startConsent(
      { exec: noDatabase },
      {
        tenantId: TENANT,
        source: "gmail",
        startedBy: "",
      },
    );

    expect(started).toEqual({ ok: false, reason: "not-configured", provider: "google" });
  });

  it("an unsupported source is refused", async () => {
    const started = await startConsent(
      { exec: noDatabase, google },
      { tenantId: TENANT, source: "hubspot", startedBy: "" },
    );

    expect(started).toEqual({ ok: false, reason: "unsupported-source" });
  });

  it("xero with no Xero client configured is refused, even with Google configured", async () => {
    const started = await startConsent(
      { exec: noDatabase, google },
      { tenantId: TENANT, source: "xero", startedBy: "" },
    );

    expect(started).toEqual({ ok: false, reason: "not-configured", provider: "xero" });
  });
});

/**
 * The same refusal as the admin reads it, through the router: the sentence names the provider
 * of the source that was pressed. It used to name Google whatever was pressed, so a deployment
 * with Google configured and Xero not told the admin who pressed Connect Xero that Google was
 * not set up (issue 211). Both languages, because the name is interpolated into each
 * catalogue's own sentence and either could have kept the old wording.
 */
describe("a consent that cannot start names the provider of the source pressed", () => {
  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
    ADMIN.userId = await seedUser(ADMIN.email, "admin");
    await db.become("undercroft_app");
  });

  afterEach(async () => {
    await db.close();
  });

  /** An admin's caller whose deployment holds exactly the clients in `deps`. */
  function adminCaller(
    locale: Locale,
    deps: { google?: typeof google },
  ): ReturnType<typeof appRouter.createCaller> {
    const ctx: Context = {
      exec: db,
      user: { userId: ADMIN.userId, email: ADMIN.email },
      credentialId: "s1",
      via: "session",
      grant: "write",
      superadmin: false,
      locale,
      endSession: () => Promise.resolve(),
      apps: null,
      notifyInvitation: () => Promise.resolve(false),
      startConsent: (start) => startConsent({ exec: db, ...deps }, start),
      worker: null,
      googlePicker: null,
    };
    return appRouter.createCaller(ctx);
  }

  async function refusalOf(
    locale: Locale,
    deps: { google?: typeof google },
    source: string,
  ): Promise<string> {
    try {
      await adminCaller(locale, deps).connections.startOAuth({ tenantId: TENANT, source });
    } catch (error) {
      if (error instanceof TRPCError && error.code === "PRECONDITION_FAILED") {
        return error.message;
      }
      throw error;
    }
    throw new Error("expected the consent to be refused");
  }

  for (const locale of LOCALES) {
    it(`xero with only Google configured names Xero, not Google (${locale})`, async () => {
      const message = await refusalOf(locale, { google }, "xero");

      expect(message).toContain("Xero");
      expect(message).not.toContain("Google");
    });

    it(`gmail with nothing configured names Google (${locale})`, async () => {
      const message = await refusalOf(locale, {}, "gmail");

      expect(message).toContain("Google");
      expect(message).not.toContain("Xero");
    });
  }
});
