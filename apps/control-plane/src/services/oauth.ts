/**
 * The per-tenant consent: the decisions, with no transport in them.
 *
 * This is NOT sign-in. Signing in asks for `openid email profile` and is Better Auth's;
 * this asks for a customer's mailbox, documents or accounts, per tenant, and its credential
 * is sealed by the worker into `app.connection_secret`. Keeping the two apart is the reason
 * the login client and the ingestion client are different Google clients: one misconfigured
 * scope list on the login path would otherwise hand over a mailbox as a side effect of
 * signing in.
 *
 * Two providers go through here, Google and Xero, and this flow knows neither by name: what
 * differs between them is a table in `oauthProviders.ts`, and the provider a source uses is
 * looked up from it.
 *
 * WHAT THIS FILE REFUSES, AND WHY EACH ONE MATTERS.
 *
 * - **No configured client → no authorize URL.** Better a source that reads "not
 *   connected" than a button that sends somebody to a provider's error page.
 * - **The state must be live, unused and unexpired.** One `DELETE ... RETURNING` decides
 *   all three, so a replayed callback cannot win a race against its own first use.
 * - **The callback's provider must be the handshake's.** A Google code arriving at the Xero
 *   callback is a state somebody moved between flows, and is refused as no state at all.
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
import {
  type GoogleIngestConfig,
  type Provider,
  type ProviderConfig,
  PROVIDERS,
  providerOf,
  redirectUri,
} from "./oauthProviders.ts";
import { exchangeCode } from "./tokenExchange.ts";
import type { WorkerClient } from "./workerClient.ts";

// Re-exported so callers keep naming one seam: this module is what they reason about.
export type { GoogleIngestConfig, Provider, ProviderConfig } from "./oauthProviders.ts";

/** Minutes, not hours: a consent is a thing somebody is doing right now. */
const HANDSHAKE_TTL_MS = 15 * 60 * 1000;

/** The scopes each source asks for, across every provider. See `oauthProviders.ts`. */
export const SOURCE_SCOPES: Readonly<Record<string, readonly string[]>> = Object.assign(
  {},
  ...Object.values(PROVIDERS).map((shape) => shape.scopes),
) as Record<string, readonly string[]>;

export function isGoogleSource(source: string): boolean {
  return providerOf(source) === "google";
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
 * so adding a scope to a provider's table cannot leave a stale copy behind that accepts a
 * grant missing it.
 */
function capabilityScopes(requestedScope: string): string[] {
  return requestedScope.split(" ").filter((scope) => scope !== "" && !IDENTITY_SCOPES.has(scope));
}

/**
 * What a source asks for, as the one space-delimited string every comparison here uses.
 *
 * A source with no entry answers `""`, and so has no capability to withhold: HubSpot does
 * not come through this flow at all, and a grant check that invented a requirement for it
 * would park a working connection at "reconnect" forever.
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
  readonly xero?: ProviderConfig;
  readonly worker?: WorkerClient;
  readonly now?: () => Date;
}

/** The deployment's client for a provider, or `undefined` when it has none. */
function configFor(deps: OAuthDeps, provider: Provider): ProviderConfig | undefined {
  return deps[provider];
}

export type StartOutcome =
  | { ok: true; authorizeUrl: string }
  | { ok: false; reason: "not-configured" | "unsupported-source" };

/**
 * Begin a consent: record the handshake, return the URL to send the browser to.
 *
 * The provider's own authorize parameters (`oauthProviders.ts`) are what make it issue a
 * refresh token; a PKCE challenge rides along where the provider takes one. The verifier
 * is stored on the handshake either way -- the column is not nullable, and an unused
 * verifier costs nothing.
 */
export async function startConsent(
  deps: OAuthDeps,
  input: { tenantId: string; source: string; startedBy: string },
): Promise<StartOutcome> {
  const provider = providerOf(input.source);
  if (provider === null) {
    return { ok: false, reason: "unsupported-source" };
  }
  const config = configFor(deps, provider);
  if (config === undefined) {
    return { ok: false, reason: "not-configured" };
  }
  const shape = PROVIDERS[provider];
  const scopes = shape.scopes[input.source] ?? [];

  // Housekeeping on the way past: abandoned consents leave rows holding a live PKCE
  // verifier, and this is the only path that runs often enough to need no scheduler.
  await pruneExpiredHandshakes(deps.exec);

  const state = randomToken();
  const pkce = createPkce();
  const now = (deps.now ?? ((): Date => new Date()))();

  await startHandshake(deps.exec, {
    stateSha256: hashToken(state),
    tenantId: input.tenantId,
    source: input.source,
    verifier: pkce.verifier,
    requestedScope: scopes.join(" "),
    startedBy: input.startedBy,
    expiresAt: new Date(now.getTime() + HANDSHAKE_TTL_MS).toISOString(),
  });

  const url = new URL(config.authorizeUrl ?? shape.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(config.publicUrl, provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  for (const [key, value] of Object.entries(shape.authorizeParams)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("state", state);
  if (shape.pkce) {
    url.searchParams.set("code_challenge", pkce.challenge);
    url.searchParams.set("code_challenge_method", pkce.method);
  }

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
  input: {
    provider: Provider;
    state: string;
    code: string;
    caller: { userId: string; email: string } | null;
  },
): Promise<CompleteOutcome> {
  const { worker } = deps;
  const config = configFor(deps, input.provider);
  if (config === undefined || worker === undefined) {
    return { ok: false, reason: "not-configured" };
  }

  const handshake = await consumeHandshake(deps.exec, hashToken(input.state));
  // Unknown, already used, expired, and started with another provider: answered
  // identically on purpose.
  if (handshake === null || providerOf(handshake.source) !== input.provider) {
    return { ok: false, reason: "bad-state" };
  }

  const { caller } = input;
  if (caller === null || !(await deps.hasAdminAuthority(handshake.tenantId, caller))) {
    return {
      ok: false,
      reason: "not-admin",
      tenantId: handshake.tenantId,
      source: handshake.source,
    };
  }

  const exchanged = await exchangeCode(input.provider, config, {
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
    // Google's opaque `sub`, never the address: `ops.connection` is readable by BI. Xero
    // names nobody here; its organisation id is recorded when the admin chooses one.
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
  // a connection that does not exist is worse than no label. A provider that names nobody
  // writes nothing; the organisation's name arrives with the scope.
  if (exchanged.email !== "") {
    await writeConnectionDetail(deps.exec, {
      tenantId: handshake.tenantId,
      source: handshake.source,
      accountLabel: exchanged.email,
    });
  }

  // Swallowed exactly as `recordRefusal` swallows its own, and for the same reason: a
  // failed audit insert must not undo a consent that has already succeeded at the provider.
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
