/**
 * Opening a spec run: the spec, the request context, and the entities as this connection's
 * scope and grant read them.
 *
 * Split from `runPaths.ts`, which holds how a spec run READS; this holds what it reads, which
 * is where a scope reaches a spec run and the only place it does. The runtime is handed the
 * entities this answers with and never learns there was a choice. ADR 0052.
 *
 * The recorded grant narrows the same list, after the scope: a list the grant cannot read is
 * never requested, and is handed back beside the reads with the scope it lacks, so the run can
 * say so (`grant.ts`, ADR 0073).
 */

import { createFetcher, type RunContext } from "@undercroft/connector-runtime";
import {
  type ConnectionScope,
  type ConnectorEntity,
  type ConnectorSpec,
  parseScope,
} from "@undercroft/contracts";
import { getConnection, readConnectionDetail } from "@undercroft/db/repos";

import { partitionByGrant, type UngrantedRead } from "./grant.ts";
import { withChosenProperties } from "./hubspot/properties.ts";
import type { RunDeps } from "./runTypes.ts";
import { resolveToken } from "./runTypes.ts";
import { readSpec } from "./specs.ts";

/**
 * What a spec run reads, as the connection records it: the provider's account id, the scope an
 * admin chose, and what the provider granted. `null` for either of the first two means there is
 * none -- a source with no organisation to name, or a connection nobody has scoped -- and the
 * spec is read as it is written; `""` for the grant means nothing was recorded, which judges
 * nothing.
 */
async function chosenFor(
  deps: Pick<RunDeps, "exec">,
  input: { source: string; tenantId: string },
): Promise<{ accountId: string | null; scope: ConnectionScope | null; granted: string }> {
  const connection = await getConnection(deps.exec, input.tenantId, input.source);
  const detail = await readConnectionDetail(deps.exec, input.tenantId, input.source);
  const scope = detail === null ? null : parseScope(input.source, detail.selectionJson);
  const accountId = connection?.externalAccountId ?? null;
  return {
    accountId: accountId === "" ? null : accountId,
    scope,
    granted: connection?.scope ?? "",
  };
}

/**
 * The spec's entities as this connection's scope reads them, in spec order.
 *
 * Two scopes shape a spec run and they pull in opposite directions. Xero's NARROWS which
 * entities are read, where an empty list means every one. HubSpot's WIDENS what each object read
 * asks for, and never below what the spec itself asks (`hubspot/properties.ts`). Any other
 * scope, or none, reads the spec as it is written. This is the one place a scope reaches a spec
 * run: the runtime is handed the entities this returns and never learns there was a choice.
 */
function scopedEntities(spec: ConnectorSpec, scope: ConnectionScope | null): ConnectorEntity[] {
  if (scope?.kind === "xero" && scope.entities.length > 0) {
    return spec.entities.filter((entity) => scope.entities.includes(entity.name));
  }
  if (scope?.kind === "hubspot") {
    return spec.entities.map((entity) => withChosenProperties(entity, scope));
  }
  return spec.entities;
}

/** What one spec run needs, gathered once before the first entity is read. */
export interface SpecRun {
  readonly spec: ConnectorSpec;
  readonly ctx: RunContext;
  /**
   * In spec order. Which request each one's watermark belongs to is the runtime's `requestKey`
   * of the entity as given here, so a scope that changed the request has changed the key too.
   */
  readonly entities: readonly ConnectorEntity[];
  /** The lists the scope chose that the grant cannot read, in spec order. Never requested. */
  readonly ungranted: readonly UngrantedRead[];
}

/**
 * Open a spec run: the spec, the request context, and the entities as the admin's scope and the
 * recorded grant read them.
 *
 * Spec ORDER is kept through the scope, because a `batch-from` relation reads against ids
 * harvested from an entity declared before it; the spec schema refuses an unknown reference,
 * and a reordered list would turn that check into a run that silently read nothing.
 */
export async function openSpecRun(
  deps: RunDeps,
  input: { source: string; tenantId: string },
): Promise<SpecRun> {
  const spec = readSpec(deps.specsDir, input.source);
  const chosen = await chosenFor(deps, input);

  const ctx: RunContext = {
    fetcher: deps.fetcher ?? createFetcher(spec.defaults.timeoutMs),
    // Only attach a token resolver when the connector authenticates. Under
    // exactOptionalPropertyTypes an explicit `undefined` is not the same as omitting it.
    ...(spec.auth.kind === "none"
      ? {}
      : { token: (): Promise<string> => resolveToken(deps, input) }),
    // The provider's account id -- the Xero organisation chosen after consent -- for the
    // header the spec names. The runtime refuses to send a request without it.
    ...(chosen.accountId === null ? {} : { accountId: chosen.accountId }),
  };

  const { granted, ungranted } = partitionByGrant(
    scopedEntities(spec, chosen.scope),
    chosen.granted,
  );

  return { spec, ctx, entities: granted, ungranted };
}
