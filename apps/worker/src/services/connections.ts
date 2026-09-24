/**
 * Sealing, browsing and revoking a per-tenant connection.
 *
 * The worker does these three because it holds `UNDERCROFT_SECRET_KEY` and the control
 * plane deliberately does not. The control plane runs the browser half of the consent --
 * Google's redirect needs a public URL, and the worker has none -- then hands the token
 * bundle over the internal network on the trigger-token allowlist. What that preserves is
 * narrow and worth naming: the internet-facing service can never *read* a stored
 * credential, because it has no key to open one with. ADR 0016.
 *
 * Every function returns a tagged result rather than throwing a status code. Deciding what
 * "unknown tenant" means over HTTP is the handler's business (`layer-service-no-upward`),
 * and a service that threw one would be callable from exactly one caller.
 */

import {
  type BrowseListing,
  type BrowseScopeResponse,
  type CredentialInput,
  MULTI_ACCOUNT_KINDS,
  sourceKind,
} from "@undercroft/contracts";
import type { ByteFetcher } from "@undercroft/core";
import { ConnectorError, createByteFetcher, HttpError, raiseForByteStatus } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import {
  deleteCredential,
  readCredential,
  tenantExists,
  upsertConnection,
  writeCredential,
} from "@undercroft/db/repos";
import { grantExpiryFor } from "@undercroft/db/services";

import { createGoogleApi } from "./google/api.ts";
import { isGoogleSource } from "./google/collect.ts";
import { listDriveChoices } from "./google/driveChoices.ts";
import { listLabels } from "./google/gmail.ts";
import { GrantTooNarrow, requireReadGrant } from "./google/grant.ts";
import type { Transactor } from "./runTypes.ts";
import { validateCredential } from "./validateCredential.ts";
import { listOrganisations } from "./xero/organisations.ts";
import { xeroClientAuthorization } from "./xero/refresh.ts";

export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const XERO_REVOKE_URL = "https://identity.xero.com/connect/revocation";

/** What revoking at Xero needs beyond the token: the client that minted it. */
export interface XeroClient {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly revocationUrl?: string;
}

export interface StoreCredentialDeps {
  readonly exec: SqlExecutor;
  readonly transactor?: Transactor;
  readonly env?: NodeJS.ProcessEnv;
  /** For probing a pasted token before it is sealed. Absent, `validate` cannot be honoured. */
  readonly fetcher?: ByteFetcher;
}

export type StoreCredentialOutcome =
  | { ok: true; expiresAt: string | null }
  | { ok: false; reason: "unknown-tenant" }
  /** The provider refused the credential; nothing was written. */
  | { ok: false; reason: "credential-rejected" }
  /** Validation was asked for and this source has no way to be probed; nothing was written. */
  | { ok: false; reason: "cannot-validate" }
  /**
   * The credential is for a different account than the one this source is pinned to, or names
   * no account where one is required; nothing was written. ADR 0043.
   */
  | { ok: false; reason: "account-mismatch" };

/**
 * Record a connection and seal its credential.
 *
 * Both writes or neither. `app.connection_secret` has a foreign key to `ops.connection`, so
 * the order is forced -- and a half-applied consent leaves a connection the UI shows as
 * live with nothing behind it, which fails at the next run rather than at the click that
 * caused it.
 *
 * With `validate`, the credential is proven against the provider BEFORE either write. A
 * pasted token that fails the probe leaves no row behind, so the card keeps saying "not
 * connected" -- which is the truth -- rather than "connected" over a token that cannot read.
 */
export async function storeCredential(
  deps: StoreCredentialDeps,
  input: {
    source: string;
    tenantId: string;
    externalAccountId: string;
    scope: string;
    credential: CredentialInput;
    validate?: boolean;
  },
): Promise<StoreCredentialOutcome> {
  if (!(await tenantExists(deps.exec, input.tenantId))) {
    // Checked rather than left to the foreign key, so the answer is a refusal the handler
    // can turn into a 404 instead of a constraint violation that reads as a server fault.
    return { ok: false, reason: "unknown-tenant" };
  }

  if (input.validate === true) {
    const proven = await validateCredential(
      { fetcher: deps.fetcher ?? createByteFetcher() },
      { source: input.source, token: input.credential.accessToken },
    );
    if (!proven.ok) {
      return {
        ok: false,
        reason: proven.reason === "rejected" ? "credential-rejected" : "cannot-validate",
      };
    }
  }

  // A source that may hold several accounts is keyed by which account it is, so a credential
  // that names none cannot be pinned -- and unpinned, the next consent for anybody would be
  // accepted into it. Refused here as well as in the control plane, because this is the one
  // process that seals.
  if (MULTI_ACCOUNT_KINDS.has(sourceKind(input.source)) && input.externalAccountId === "") {
    return { ok: false, reason: "account-mismatch" };
  }

  const run: Transactor =
    deps.transactor ?? (<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> => fn(deps.exec));
  const pinned = await run(async (tx) => {
    const recorded = await upsertConnection(tx, {
      tenantId: input.tenantId,
      source: input.source,
      status: "connected",
      externalAccountId: input.externalAccountId,
      scope: input.scope,
    });
    // The connection belongs to another account, so nothing is sealed: the foreign key means
    // there is no credential row to write without the connection row the guard refused.
    if (!recorded) {
      return false;
    }
    await writeCredential(
      tx,
      input.tenantId,
      input.source,
      {
        accessToken: input.credential.accessToken,
        refreshToken: input.credential.refreshToken,
        expiresAt: input.credential.expiresAt,
      },
      {
        ...(deps.env === undefined ? {} : { env: deps.env }),
        grantExpiresAt: grantExpiryFor(input.source),
      },
    );
    return true;
  });
  if (!pinned) {
    return { ok: false, reason: "account-mismatch" };
  }

  return { ok: true, expiresAt: input.credential.expiresAt };
}

export interface BrowseDeps {
  readonly exec: SqlExecutor;
  readonly fetcher: ByteFetcher;
  /** A property, not a method: it is passed by reference, and a method would carry `this`. */
  readonly token: () => Promise<string>;
}

/** One listing's answer: what may be chosen, and which kinds of it the list is not whole in. */
type Choices = Pick<BrowseScopeResponse, "items" | "partial">;

export type BrowseOutcome =
  | ({ ok: true } & Choices)
  | { ok: false; reason: "unsupported" | "scope-insufficient" };

/**
 * What an admin may choose from: Gmail's labels, the organisations a Xero consent sees, or
 * Drive's folders and the file types across them.
 *
 * Drive had no listing while its grant was `drive.file`: that scope sees nothing that has not
 * been picked, so a server-side listing was impossible. ADR 0047 moved it to `drive.readonly`,
 * and a Drive scope can now be chosen here as well as in the browser's Picker -- which is what
 * an agent at the CLI has, having no browser.
 *
 * A grant that cannot list is a *refusal*, not a fault. Left to raise, Google's 403 became
 * a 500 here, which the control plane could only read as "the worker is broken" -- and the
 * operator was told the processing service was down when what had happened was that nobody
 * ticked the Gmail box. The remedy is a reconnect, and nothing upstream of a tagged outcome
 * can say so. The same holds for a grant recorded without the source's read scope, which is
 * refused before Google is asked: a `drive.file` grant would not be refused by Google at all,
 * it would answer with an empty list that reads as an empty drive.
 */
export async function browseScope(
  deps: BrowseDeps,
  input: { source: string; tenantId: string; kind: BrowseListing },
): Promise<BrowseOutcome> {
  const listing = listingFor(deps, input);
  if (listing === null) {
    return { ok: false, reason: "unsupported" };
  }
  try {
    return { ok: true, ...(await listing()) };
  } catch (error) {
    if (error instanceof GrantTooNarrow || deniedForCredential(error)) {
      return { ok: false, reason: "scope-insufficient" };
    }
    // Everything else still raises. A 500 from Google, a timeout or a parse failure IS an
    // outage, and answering those with "reconnect and grant the permission" would send an
    // operator to revoke a working credential.
    throw error;
  }
}

/**
 * The one listing each (source, kind) has, or null for a pair this worker cannot list.
 *
 * Decided before anything is read, so a pair nobody lists is refused without a statement.
 * A Google listing checks the recorded grant first, inside the thunk, for the same reason a
 * run does (`grant.ts`).
 */
function listingFor(
  deps: BrowseDeps,
  input: { source: string; tenantId: string; kind: BrowseListing },
): (() => Promise<Choices>) | null {
  const kind = sourceKind(input.source);
  if (kind === "xero" && input.kind === "organisations") {
    return async () => ({
      items: await listOrganisations({ fetcher: deps.fetcher, token: deps.token }),
      partial: [],
    });
  }
  const google =
    (kind === "gmail" && input.kind === "labels") || (kind === "drive" && input.kind === "folders");
  if (!google) {
    return null;
  }
  return async () => {
    await requireReadGrant(deps.exec, input);
    const api = createGoogleApi(input.source, { fetcher: deps.fetcher, token: deps.token });
    return kind === "drive" ? listDriveChoices(api) : { items: await listLabels(api), partial: [] };
  };
}

/**
 * The two statuses that mean "this credential may not", as opposed to "this did not work".
 *
 * Both, because Google uses both for a grant that cannot do the job: a revoked or expired
 * token answers 401, and a token whose scopes fall short answers 403. A reconnect is the
 * repair for either.
 */
const UNAUTHENTICATED = 401;
const FORBIDDEN = 403;

/**
 * The HTTP failure inside a collector's wrapper, if that is what it is.
 *
 * `createGoogleApi` wraps whatever it caught in a `ConnectorError` so the record count
 * survives, which puts the status one level down. Read without unwrapping, every Google
 * refusal looks like a generic connector fault.
 */
function httpCauseOf(error: unknown): HttpError | null {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof ConnectorError && error.cause instanceof HttpError) {
    return error.cause;
  }
  return null;
}

/** Whether a failure is Google saying no to this credential, rather than a fault. */
function deniedForCredential(error: unknown): boolean {
  const status = httpCauseOf(error)?.status;
  return status === UNAUTHENTICATED || status === FORBIDDEN;
}

export interface RevokeDeps {
  readonly exec: SqlExecutor;
  readonly fetcher: ByteFetcher;
  /** Resolves the token to revoke. Absent or failing means we still forget our copy. */
  /** A property, not a method: it is passed by reference, and a method would carry `this`. */
  readonly token: () => Promise<string>;
  /** Xero revokes by REFRESH token with the client's own credential; absent, we only forget ours. */
  readonly xero?: XeroClient;
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Forget a credential, and tell the provider to forget it too.
 *
 * The upstream call is best-effort and its outcome is *reported*, never assumed. Our row
 * disappearing while the provider's grant stands would make "you can disconnect at any
 * time" -- copy already on the consent card -- a half-truth. But a provider outage must not
 * leave a customer unable to disconnect, so the local delete happens either way.
 */
export async function revokeConnection(
  deps: RevokeDeps,
  input: { source: string; tenantId: string },
): Promise<{ revokedUpstream: boolean }> {
  let revokedUpstream = false;

  try {
    revokedUpstream = await revokeUpstream(deps, input);
  } catch {
    // Swallowed on purpose, and the only place in this module that swallows anything: a
    // token already revoked at the provider answers 400, and refusing to disconnect over
    // that would trap a customer in a connection they have asked to end.
    revokedUpstream = false;
  }

  await deleteCredential(deps.exec, input.tenantId, input.source);
  return { revokedUpstream };
}

/** Tell the provider, in the way each provider is told. `false` when this one cannot be. */
async function revokeUpstream(
  deps: RevokeDeps,
  input: { source: string; tenantId: string },
): Promise<boolean> {
  if (isGoogleSource(input.source)) {
    const token = await deps.token();
    const request = {
      url: GOOGLE_REVOKE_URL,
      method: "POST" as const,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    };
    const response = await deps.fetcher.send(request);
    raiseForByteStatus(request, response);
    return true;
  }
  if (sourceKind(input.source) === "xero" && deps.xero !== undefined) {
    // The refresh token, not the access token: revoking it ends the grant and every
    // connection under it, which is what "disconnect" means to the customer.
    const credential = await readCredential(
      deps.exec,
      input.tenantId,
      input.source,
      deps.env === undefined ? {} : { env: deps.env },
    );
    const request = {
      url: deps.xero.revocationUrl ?? XERO_REVOKE_URL,
      method: "POST" as const,
      headers: {
        authorization: xeroClientAuthorization(deps.xero),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token: credential.refreshToken }).toString(),
    };
    const response = await deps.fetcher.send(request);
    raiseForByteStatus(request, response);
    return true;
  }
  return false;
}
