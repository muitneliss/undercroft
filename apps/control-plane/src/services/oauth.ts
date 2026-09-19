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
import { exchangeCode, type GoogleIngestConfig, redirectUri } from "./googleExchange.ts";
import type { WorkerClient } from "./workerClient.ts";

// Re-exported so callers keep naming one seam: this module is what they reason about.
export type { GoogleIngestConfig };

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

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

/**
 * The scopes that ride along to name the account and grant nothing further.
 *
 * They are excluded from every granted-scope comparison for a mundane reason: Google does
 * not hand back what you asked for. `email` returns as
 * `https://www.googleapis.com/auth/userinfo.email`, so a set difference over the whole
 * string reports a scope missing that was granted, and the check would refuse every
 * consent there is.
 */
const IDENTITY_SCOPES: ReadonlySet<string> = new Set(["openid", "email"]);

/**
 * What a consent has to come back with to be worth keeping.
 *
 * Derived from what was actually requested rather than from a second hand-maintained list,
 * so adding a scope to `SOURCE_SCOPES` cannot leave a stale copy behind that accepts a
 * grant missing it.
 */
function capabilityScopes(requestedScope: string): string[] {
  return requestedScope.split(" ").filter((scope) => scope !== "" && !IDENTITY_SCOPES.has(scope));
}

/**
 * What a source asks for, as the one space-delimited string every comparison here uses.
 *
 * A source with no entry answers `""`, and so has no capability to withhold: HubSpot and
 * Xero do not come through this flow at all, and a grant check that invented a requirement
 * for them would park a working connection at "reconnect" forever.
 */
export function requestedScopeFor(source: string): string {
  return (SOURCE_SCOPES[source] ?? []).join(" ");
}

/**
 * Whether a grant carries every capability that was asked for.
 *
 * Google's consent screen lets a person untick an individual permission and press Allow
 * anyway. What comes back is a valid token for a narrower grant -- so the exchange
 * succeeds, the credential seals, and the connection reads `connected` while being able to
 * read nothing at all. The first symptom is a 403 from an API call much later, worded as
 * whatever that call's failure path happens to say.
 */
export function grantCovers(requestedScope: string, grantedScope: string): boolean {
  const granted = new Set(grantedScope.split(" "));
  return capabilityScopes(requestedScope).every((scope) => granted.has(scope));
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
  if (google === undefined) {
    return { ok: false, reason: "not-configured" };
  }

  const scopes = SOURCE_SCOPES[input.source];
  if (scopes === undefined) {
    return { ok: false, reason: "unsupported-source" };
  }

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
      reason:
        | "not-configured"
        | "bad-state"
        | "not-admin"
        | "exchange-failed"
        | "scope-declined"
        | "worker-refused";
      tenantId?: string;
      source?: string;
    };

export interface CompleteDeps extends OAuthDeps {
  /**
   * Answers whether the caller may act as an admin of the tenant. Injected, so this stays
   * pure-ish.
   *
   * It takes the whole caller rather than a uuid because "admin" here means **authority**,
   * not membership, and platform authority is named by address in `UNDERCROFT_SUPERADMINS`.
   * Handed only a `userId`, the one honest implementation left is a `tenant_member` lookup --
   * which is exactly the bug this signature exists to make unwritable: a superadmin holds
   * admin in every tenant and has a row in none of them, so the consent they started was
   * refused here as `not-admin` after Google had already granted it. `authz.isAdminIn` is
   * the implementation; the type is what stops a caller inventing a narrower one.
   */
  hasAdminAuthority: (
    tenantId: string,
    caller: { userId: string; email: string },
  ) => Promise<boolean>;
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
  if (caller === null || !(await deps.hasAdminAuthority(handshake.tenantId, caller))) {
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

  // Nothing is sealed for a grant that withheld what it was asked for. `requestedScope` is
  // recorded on the handshake at the start of the flow for exactly this comparison, and
  // this is the only place that can make it: by the time a collector gets a 403, the
  // consent it came from is long gone. Storing the credential anyway is the guess rule 2
  // forbids -- a `connected` card standing in for a grant that reads nothing.
  //
  // The token is not revoked upstream. What is left at Google after this refusal is
  // `openid email`, which is what signing in already holds, and there is nothing here to
  // revoke it with: sealing is the worker's, and this path never reached it.
  if (!grantCovers(handshake.requestedScope, exchanged.scope)) {
    return {
      ok: false,
      reason: "scope-declined",
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
