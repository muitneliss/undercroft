/**
 * Browsing a connection: what its scope may be chosen from.
 *
 * Split from `connections.ts`, which seals and revokes; the worker does this for the reason it
 * does those -- a listing needs a live token, and this is the one process that may open one
 * (ADR 0016). Every function returns a tagged result rather than a status code, which is the
 * handler's to decide (`layer-service-no-upward`).
 */

import { type BrowseListing, type BrowseScopeResponse, sourceKind } from "@undercroft/contracts";
import type { ByteFetcher } from "@undercroft/core";
import { ConnectorError, HttpError } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";

import { createGoogleApi } from "./google/api.ts";
import { listDriveChoices } from "./google/driveChoices.ts";
import { listLabels } from "./google/gmail.ts";
import { GrantTooNarrow, requireReadGrant } from "./google/grant.ts";
import { listProperties } from "./hubspot/properties.ts";
import { readSpec } from "./specs.ts";
import { listOrganisations } from "./xero/organisations.ts";

export interface BrowseDeps {
  readonly exec: SqlExecutor;
  readonly fetcher: ByteFetcher;
  /** A property, not a method: it is passed by reference, and a method would carry `this`. */
  readonly token: () => Promise<string>;
  /**
   * Where the connector specs are. HubSpot's properties are listed for the objects its spec
   * reads, so a worker handed no specs cannot list them and says so as `unsupported`.
   */
  readonly specsDir?: string;
}

/** One listing's answer: what may be chosen, and which kinds of it the list is not whole in. */
type Choices = Pick<BrowseScopeResponse, "items" | "partial">;

export type BrowseOutcome =
  | ({ ok: true } & Choices)
  | { ok: false; reason: "unsupported" | "scope-insufficient" };

/**
 * What an admin may choose from: Gmail's labels, the organisations a Xero consent sees,
 * Drive's folders and the file types across them, or the properties of HubSpot's CRM objects.
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
  if (kind === "hubspot" && input.kind === "properties") {
    const { specsDir } = deps;
    if (specsDir === undefined) {
      return null;
    }
    // Whole, never `partial`: HubSpot answers every property of an object in one response.
    return async () => ({
      items: await listProperties(
        { fetcher: deps.fetcher, token: deps.token },
        readSpec(specsDir, input.source),
      ),
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

/** Whether a failure is the provider saying no to this credential, rather than a fault. */
function deniedForCredential(error: unknown): boolean {
  const status = httpCauseOf(error)?.status;
  return status === UNAUTHENTICATED || status === FORBIDDEN;
}
