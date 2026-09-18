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

// biome-ignore-all lint/style/noExportedImports: Re-exporting an imported type from a package entry point is what makes the entry point complete. Without it a consumer imports the value from one path and its type from another.

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and deliberately not done here: hoisting these literals touches many files and belongs in its own commit where the diff is reviewable, rather than buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/noMagicNumbers: In a test the number IS the assertion. `expect(delayMs).toBe(5000)` says what the code must do; `expect(delayMs).toBe(EXPECTED_BACKOFF_MS)` says only that two names agree, and it can pass while both are wrong. Naming a fixture value also puts the expected result somewhere other than the line asserting it, which is the opposite of what .claude/rules/tests.md asks for. Source files get named constants; test files keep their literals.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useDestructuring: Style preference with no correctness content, and it fires where the current form names the source of the value (`params.tenantId`), which is the thing worth seeing at the call site.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

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
      reason: "not-configured" | "bad-state" | "not-admin" | "exchange-failed" | "worker-refused";
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
