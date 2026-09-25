/**
 * Opening a spec run: the spec, the request context, and the entities as this connection's
 * scope reads them -- each with the request its watermark belongs to.
 *
 * Split from `runPaths.ts`, which holds how a spec run READS; this holds what it reads, which
 * is where a scope reaches a spec run and the only place it does. The runtime is handed the
 * entities this answers with and never learns there was a choice. ADR 0052.
 */

import { createHash } from "node:crypto";
import { createFetcher, type RunContext } from "@undercroft/connector-runtime";
import {
  type ConnectionScope,
  type ConnectorEntity,
  type ConnectorSpec,
  parseScope,
} from "@undercroft/contracts";
import { canonicalJson } from "@undercroft/core";
import { getConnection, readConnectionDetail } from "@undercroft/db/repos";

import { withChosenProperties } from "./hubspot/properties.ts";
import type { RunDeps } from "./runTypes.ts";
import { resolveToken } from "./runTypes.ts";
import { readSpec } from "./specs.ts";

/**
 * What a spec run reads, as the connection records it: the provider's account id, and the
 * scope an admin chose. `null` for either means there is none -- a source with no organisation
 * to name, or a connection nobody has scoped -- and the spec is read as it is written.
 */
async function chosenFor(
  deps: Pick<RunDeps, "exec">,
  input: { source: string; tenantId: string },
): Promise<{ accountId: string | null; scope: ConnectionScope | null }> {
  const connection = await getConnection(deps.exec, input.tenantId, input.source);
  const detail = await readConnectionDetail(deps.exec, input.tenantId, input.source);
  const scope = detail === null ? null : parseScope(input.source, detail.selectionJson);
  const accountId = connection?.externalAccountId ?? null;
  return { accountId: accountId === "" ? null : accountId, scope };
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

/**
 * Which request an entity's watermark was read under: `""` when the entity is read exactly as its
 * spec declares it, otherwise a digest of the request a scope made of it.
 *
 * A watermark says how far ONE request's answers were read. Handed to a different request it is
 * a claim about records that request never asked for: widen HubSpot's companies by a property
 * today, keep yesterday's mark, and every company that has not changed since is filtered out of
 * the read -- the new property reaches only the records that happen to change, and the lake
 * never says which. So a changed request starts from no mark, which costs one full read;
 * `raw.sync_cursor.request_key` is where this lives (ADR 0052, extending ADR 0034).
 *
 * `""` for an entity read as declared, rather than a digest of the spec's request, so every
 * cursor written before this existed -- and every spec run that no scope touches -- keeps its
 * mark across the deploy that brought it in. Decided by identity, which `scopedEntities`
 * preserves for any entity a scope leaves alone.
 */
function requestKeyOf(declared: ConnectorEntity | undefined, read: ConnectorEntity): string {
  if (declared === read) {
    return "";
  }
  return createHash("sha256").update(canonicalJson(read.request)).digest("hex");
}

/** One entity as this run reads it, and the request its watermark belongs to. */
export interface EntityRead {
  readonly entity: ConnectorEntity;
  /** See {@link requestKeyOf}. */
  readonly requestKey: string;
}

/** What one spec run needs, gathered once before the first entity is read. */
export interface SpecRun {
  readonly spec: ConnectorSpec;
  readonly ctx: RunContext;
  readonly reads: readonly EntityRead[];
}

/**
 * Open a spec run: the spec, the request context, and the entities as the admin's scope reads
 * them.
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

  const declared = new Map(spec.entities.map((entity) => [entity.name, entity]));
  const reads = scopedEntities(spec, chosen.scope).map((entity) => ({
    entity,
    requestKey: requestKeyOf(declared.get(entity.name), entity),
  }));

  return { spec, ctx, reads };
}
