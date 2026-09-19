/**
 * Prove a pasted credential works before it is sealed.
 *
 * A HubSpot private-app token is typed or pasted by an administrator, and nothing about a
 * string proves it is the right one. Sealed unchecked, a typo becomes a `connected` card
 * whose first run 401s after zero records -- hours later, worded as whatever that run's
 * failure path says. One cheap read against the provider, before any write, turns that
 * into a refusal at the moment of the paste.
 *
 * The probe reads the smallest thing the connector will read anyway, so a token that
 * passes here is a token the first run can use. A provider that is DOWN is not a rejected
 * token: a 5xx or a timeout raises, and the caller reports an outage rather than telling
 * an admin their token is wrong.
 */

import type { ByteFetcher } from "@undercroft/core";
import { raiseForByteStatus } from "@undercroft/core";

/** The one request each pasted-token source is probed with. */
const PROBES: Readonly<Record<string, string>> = {
  hubspot: "https://api.hubapi.com/crm/v3/objects/companies?limit=1",
};

/** Sources whose credential is a pasted token rather than an OAuth consent. */
export const PASTED_TOKEN_SOURCES: ReadonlySet<string> = new Set(Object.keys(PROBES));

export type ValidationOutcome =
  | { ok: true }
  /** The provider answered and said no. A reconnect with the right token is the remedy. */
  | { ok: false; reason: "rejected" }
  /** No probe exists for this source, so nothing can be proven about the credential. */
  | { ok: false; reason: "unsupported" };

const UNAUTHENTICATED = 401;
const FORBIDDEN = 403;

export async function validateCredential(
  deps: { readonly fetcher: ByteFetcher },
  input: { readonly source: string; readonly token: string },
): Promise<ValidationOutcome> {
  const url = PROBES[input.source];
  if (url === undefined) {
    return { ok: false, reason: "unsupported" };
  }
  const request = {
    url,
    method: "GET" as const,
    headers: { authorization: `Bearer ${input.token}`, accept: "application/json" },
  };
  const response = await deps.fetcher.send(request);
  if (response.status === UNAUTHENTICATED || response.status === FORBIDDEN) {
    return { ok: false, reason: "rejected" };
  }
  // Anything else that is not a success is the provider's fault, and raises as such.
  raiseForByteStatus(request, response);
  return { ok: true };
}
