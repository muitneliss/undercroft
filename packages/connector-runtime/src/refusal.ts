/**
 * The one failure a read is allowed to hand back as something other than a failure: the source
 * saying, on a list's first request, that this credential may not read that list.
 *
 * A pasted token carries whatever permissions somebody ticked at the provider, and nothing here
 * records which. A HubSpot private app without the quotes scope reads companies, contacts and
 * deals perfectly well and is refused on quotes alone -- and a run that failed there would lose
 * every list the token CAN read (issue 279). So when the spec's auth declares how its source says
 * this (`grantRefusal`), the answer becomes {@link EntityNotGranted}, and the worker names the
 * list and its scope as not granted, exactly as ADR 0073 names a list a recorded grant lacks.
 *
 * Narrow on purpose, because every other failure must still raise (`.claude/rules/connectors.md`):
 *
 * - only the status and the category the source uses for exactly this. HubSpot answers a missing
 *   scope with `403` and `category: "MISSING_SCOPES"` -- the category is HubSpot's own, from its
 *   error handling in `hubspot-local-dev-lib`, since the error guide documents only the status.
 *   A 403 with any other body is not read as a missing permission;
 * - only on the list's FIRST request. A refusal after a page has been answered is a credential
 *   that changed under a running read, and the records already landed make it a partial read,
 *   which is a failure, not a list that was never readable. ADR 0074.
 */

import type { ConnectorEntity, ConnectorSpec } from "@undercroft/contracts";
import { ConnectorError, getPath, parseLossless } from "@undercroft/core";

import type { HttpResponse } from "./fetcher.ts";
import { assertNever } from "./paging.ts";

/** The list could not be read because the credential lacks a permission. Never a partial read. */
export class EntityNotGranted extends ConnectorError {
  /** What granting would add, as the source spells it: at least one, never a guess. */
  readonly scopes: readonly string[];

  constructor(connector: string, entity: string, scopes: readonly string[]) {
    super(
      connector,
      entity,
      0,
      `the credential may not read this list; it needs ${scopes.join(", ")}`,
    );
    this.scopes = scopes;
  }
}

const FORBIDDEN = 403;
const MISSING_SCOPES = "MISSING_SCOPES";

/** HubSpot names the scopes in `errors[].context`, under a key ending `Scopes` (`missingScopes` in its OpenAPI example). */
const SCOPES_KEY = /Scopes$/u;

/**
 * The scopes this answer says the credential lacks for the entity's list, or `null` when it is
 * not a refusal of that kind -- in which case the caller raises it like any other answer.
 *
 * The scope named is the entity's own `readScope` when HubSpot names it among the ones it would
 * accept, or names none: that is the one the runbook tells an admin to tick. When HubSpot names
 * others and not that one, its own word wins, because it is the one refusing.
 */
export function refusedScopes(
  spec: ConnectorSpec,
  entity: ConnectorEntity,
  response: HttpResponse,
): readonly string[] | null {
  if (spec.auth.kind !== "bearer" || spec.auth.grantRefusal === undefined) {
    return null;
  }
  switch (spec.auth.grantRefusal) {
    case "hubspot-missing-scopes":
      return hubspotMissingScopes(entity, response);
    default:
      return assertNever(spec.auth.grantRefusal, "grant refusal");
  }
}

function hubspotMissingScopes(
  entity: ConnectorEntity,
  response: HttpResponse,
): readonly string[] | null {
  if (response.status !== FORBIDDEN) {
    return null;
  }
  let body: unknown;
  try {
    body = parseLossless(response.text);
  } catch {
    return null;
  }
  if (getPath(body, "category") !== MISSING_SCOPES) {
    return null;
  }
  const named = namedScopes(body);
  const declared = entity.readScope;
  if (declared !== undefined && (named.length === 0 || named.includes(declared))) {
    return [declared];
  }
  // The contract requires a readScope beside a grantRefusal, so an empty answer here would be a
  // spec that bypassed it; say nothing rather than name a scope nobody wrote down.
  return named.length > 0 ? named : null;
}

/** Every scope HubSpot's error body names, in the order it names them, once each. */
function namedScopes(body: unknown): string[] {
  const errors = getPath(body, "errors");
  const scopes = new Set<string>();
  for (const error of Array.isArray(errors) ? errors : []) {
    const context = getPath(error, "context");
    if (typeof context !== "object" || context === null) {
      continue;
    }
    for (const [key, value] of Object.entries(context)) {
      if (SCOPES_KEY.test(key) && Array.isArray(value)) {
        for (const scope of value) {
          if (typeof scope === "string" && scope !== "") {
            scopes.add(scope);
          }
        }
      }
    }
  }
  return [...scopes];
}
