/**
 * The per-tenant Google consent: the decisions, with no transport in them.
 *
 * This is NOT sign-in. Signing in asks for `openid email profile` and is Better Auth's;
 * this asks for a customer's mailbox or documents, per tenant, and its credential is sealed
 * by the worker into `app.connection_secret`. Keeping the two apart is the reason the login
 * client and the ingestion client are different Google clients: one misconfigured scope
 * list on the login path would otherwise hand over a mailbox as a side effect of signing in.
 *
 * WHAT THIS FILE REFUSES, AND WHY EACH ONE MATTERS.
 *
 * - **No configured ingest client → no authorize URL.** Better a source that reads "not
 *   connected" than a button that sends somebody to a Google error page.
 * - **The state must be live, unused and unexpired.** One `DELETE ... RETURNING` decides
 *   all three, so a replayed callback cannot win a race against its own first use.
 * - **The caller must still be an admin of the tenant the handshake names.** Starting a
 *   flow is not a standing authorisation: minutes pass, and a role can be withdrawn in them.
 * - **Unknown state, expired state and a wrong tenant are refused identically.** Saying
 *   which would turn the callback into an oracle for whether a guessed state ever existed.
 */

import { createPkce, hashToken, randomToken } from "@undercroft/crypto";
import type { SqlExecutor } from "@undercroft/db";
import { writeConnectionDetail } from "@undercroft/db/repos";

import { record as recordAudit } from "../repos/auditLog.ts";
import {
  consumeHandshake,
  pruneExpiredHandshakes,
  startHandshake,
} from "../repos/oauthHandshake.ts";
import type { WorkerClient } from "./workerClient.ts";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Where Google is told to come back to. One URI for both sources; the state carries which. */
export const CALLBACK_PATH = "/oauth/google/callback";

/** Minutes, not hours: a consent is a thing somebody is doing right now. */
const HANDSHAKE_TTL_MS = 15 * 60 * 1000;

/**
 * The scopes each source asks for.
 *
 * Drive is `drive.file`, deliberately, not `drive.readonly`. `drive.file` reaches only what
 * the admin picked in Google's own Picker, so the shipped promise "No other folder is read"
 * is enforced by Google rather than by our query filter -- and it is not a Google
 * "restricted" scope, so it carries no annual CASA security assessment. Gmail has no such
 * option: no non-restricted Gmail scope reaches attachments.
 *
 * `openid email` rides along so the callback learns which account consented. It is the same
 * identity scope sign-in uses and grants nothing further.
 */
export const SOURCE_SCOPES: Readonly<Record<string, readonly string[]>> = {
  gmail: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"],
  drive: ["openid", "email", "https://www.googleapis.com/auth/drive.file"],
};

export function isGoogleSource(source: string): boolean {
  return Object.hasOwn(SOURCE_SCOPES, source);
}

export interface GoogleIngestConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** The origin the BROWSER uses. Google builds `redirect_uri` from it. */
  readonly publicUrl: string;
  readonly authorizeUrl?: string;
  readonly tokenUrl?: string;
  /**
   * Injected in tests. Typed as the call this module actually makes rather than
   * `typeof fetch`, whose Bun signature carries a `preconnect` property no stand-in has and
   * none of this code uses.
   */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface OAuthDeps {
  readonly exec: SqlExecutor;
  readonly google?: GoogleIngestConfig;
  readonly worker?: WorkerClient;
  readonly now?: () => Date;
}

export type StartOutcome =
  | { ok: true; authorizeUrl: string }
  | { ok: false; reason: "not-configured" | "unsupported-source" };

/**
 * Begin a consent: record the handshake, return the URL to send the browser to.
 *
 * `access_type=offline` AND `prompt=consent` are both required. Without the first Google
 * issues no refresh token at all; without the second it issues one only on the very first
 * consent, so a customer who reconnects gets a credential that dies at the next expiry and
 * cannot be refreshed -- a failure that shows up hours later, far from its cause.
 */
export async function startConsent(
  deps: OAuthDeps,
  input: { tenantId: string; source: string; startedBy: string },
): Promise<StartOutcome> {
  const google = deps.google;
  if (google === undefined) return { ok: false, reason: "not-configured" };

  const scopes = SOURCE_SCOPES[input.source];
  if (scopes === undefined) return { ok: false, reason: "unsupported-source" };

  // Housekeeping on the way past: abandoned consents leave rows holding a live PKCE
  // verifier, and this is the only path that runs often enough to need no scheduler.
  await pruneExpiredHandshakes(deps.exec);

  const state = randomToken();
  const pkce = createPkce();
  const now = (deps.now ?? (() => new Date()))();

  await startHandshake(deps.exec, {
    stateSha256: hashToken(state),
    tenantId: input.tenantId,
    source: input.source,
    verifier: pkce.verifier,
    requestedScope: scopes.join(" "),
    startedBy: input.startedBy,
    expiresAt: new Date(now.getTime() + HANDSHAKE_TTL_MS).toISOString(),
  });

  const url = new URL(google.authorizeUrl ?? GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", google.clientId);
  url.searchParams.set("redirect_uri", redirectUri(google.publicUrl));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", pkce.method);

  return { ok: true, authorizeUrl: url.toString() };
}

export type CompleteOutcome =
  | { ok: true; tenantId: string; source: string; accountLabel: string }
  | {
      ok: false;
      reason: "not-configured" | "bad-state" | "not-admin" | "exchange-failed" | "worker-refused";
      tenantId?: string;
      source?: string;
    };

export interface CompleteDeps extends OAuthDeps {
  /** Answers whether the caller is an admin of the tenant. Injected, so this stays pure-ish. */
  isAdminOf(tenantId: string, userId: string): Promise<boolean>;
}

/**
 * Finish a consent: consume the state, exchange the code, hand the credential to the worker.
 *
 * The order is the security argument. State first, because it is the CSRF control and
 * consuming it makes a replay impossible; then the role check, because it is the
 * authorisation control and must be re-asked at the moment of use; only then is the code
 * spent. A code exchanged before those checks is a token minted into a customer's account
 * on the strength of a request nobody verified.
 */
export async function completeConsent(
  deps: CompleteDeps,
  input: { state: string; code: string; caller: { userId: string; email: string } | null },
): Promise<CompleteOutcome> {
  const google = deps.google;
  const worker = deps.worker;
  if (google === undefined || worker === undefined) {
    return { ok: false, reason: "not-configured" };
  }

  const handshake = await consumeHandshake(deps.exec, hashToken(input.state));
  if (handshake === null) {
    // Unknown, already used and expired, answered identically on purpose.
    return { ok: false, reason: "bad-state" };
  }

  const caller = input.caller;
  if (caller === null || !(await deps.isAdminOf(handshake.tenantId, caller.userId))) {
    return {
      ok: false,
      reason: "not-admin",
      tenantId: handshake.tenantId,
      source: handshake.source,
    };
  }

  const exchanged = await exchangeCode(google, {
    code: input.code,
    verifier: handshake.verifier,
  });
  if (exchanged === null) {
    return {
      ok: false,
      reason: "exchange-failed",
      tenantId: handshake.tenantId,
      source: handshake.source,
    };
  }

  const stored = await worker.storeCredential({
    source: handshake.source,
    tenantId: handshake.tenantId,
    // Google's opaque `sub`, never the address: `ops.connection` is readable by BI.
    externalAccountId: exchanged.sub,
    scope: exchanged.scope,
    credential: {
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      expiresAt: exchanged.expiresAt,
    },
  });
  if (!stored.ok) {
    return {
      ok: false,
      reason: "worker-refused",
      tenantId: handshake.tenantId,
      source: handshake.source,
    };
  }

  // The address, for the card. `app.connection_detail`, never `ops.connection`, which BI
  // can read. Written only after the worker confirmed the credential is sealed: a label for
  // a connection that does not exist is worse than no label.
  await writeConnectionDetail(deps.exec, {
    tenantId: handshake.tenantId,
    source: handshake.source,
    accountLabel: exchanged.email,
  });

  // Swallowed exactly as `recordRefusal` swallows its own, and for the same reason: a
  // failed audit insert must not undo a consent that has already succeeded at Google.
  try {
    await recordAudit(deps.exec, {
      tenantId: handshake.tenantId,
      actor: caller.email,
      action: "connection.connected",
      // Which source and who. Not the address: that is in `connection_detail`, and
      // `ops.audit_log` has a different readership.
      detail: JSON.stringify({ source: handshake.source }),
    });
  } catch {
    // Intentionally ignored; see above.
  }

  return {
    ok: true,
    tenantId: handshake.tenantId,
    source: handshake.source,
    accountLabel: exchanged.email,
  };
}

export function redirectUri(publicUrl: string): string {
  return `${publicUrl.replace(/\/+$/, "")}${CALLBACK_PATH}`;
}

interface Exchanged {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string | null;
  readonly scope: string;
  readonly sub: string;
  readonly email: string;
}

const MS_PER_SECOND = 1000;

/**
 * Spend the authorization code.
 *
 * Returns `null` on any failure rather than throwing: every failure here means the same
 * thing to the caller -- the consent did not complete -- and the differences between them
 * are Google's business, not a customer's.
 */
async function exchangeCode(
  google: GoogleIngestConfig,
  input: { code: string; verifier: string },
): Promise<Exchanged | null> {
  const doFetch = google.fetch ?? globalThis.fetch;
  try {
    const response = await doFetch(google.tokenUrl ?? GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: google.clientId,
        client_secret: google.clientSecret,
        code: input.code,
        code_verifier: input.verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(google.publicUrl),
      }).toString(),
    });
    if (!response.ok) return null;

    const body = (await response.json()) as Record<string, unknown>;
    const accessToken = typeof body["access_token"] === "string" ? body["access_token"] : "";
    if (accessToken === "") return null;

    const identity = readIdToken(body["id_token"]);
    return {
      accessToken,
      refreshToken: typeof body["refresh_token"] === "string" ? body["refresh_token"] : "",
      expiresAt:
        typeof body["expires_in"] === "number"
          ? new Date(Date.now() + body["expires_in"] * MS_PER_SECOND).toISOString()
          : null,
      scope: typeof body["scope"] === "string" ? body["scope"] : "",
      sub: identity.sub,
      email: identity.email,
    };
  } catch {
    return null;
  }
}

/**
 * Read `sub` and `email` out of the id token's payload.
 *
 * The signature is NOT verified, and that is sound here only because of where the token came
 * from: a direct, server-to-server TLS response to a request carrying our client secret and
 * a PKCE verifier we generated. There is no attacker-supplied path to this value. The same
 * two claims taken from anything a browser handed us would have to be verified.
 */
function readIdToken(idToken: unknown): { sub: string; email: string } {
  if (typeof idToken !== "string") return { sub: "", email: "" };
  const payload = idToken.split(".")[1];
  if (payload === undefined) return { sub: "", email: "" };
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    return {
      sub: typeof claims["sub"] === "string" ? claims["sub"] : "",
      email: typeof claims["email"] === "string" ? claims["email"] : "",
    };
  } catch {
    return { sub: "", email: "" };
  }
}
