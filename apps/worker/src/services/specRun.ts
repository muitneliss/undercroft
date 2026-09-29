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
 * say so (`partitionByGrant` in `@undercroft/contracts`, ADR 0073). The card asks the same rule
 * whether the connection can run, so the two cannot disagree about a list.
 */

import { createFetcher, type RunContext } from "@undercroft/connector-runtime";
import {
  type Cadence,
  type ConnectionScope,
  type ConnectorEntity,
  type ConnectorSpec,
  parseScope,
  partitionByGrant,
  type UngrantedRead,
} from "@undercroft/contracts";
import { findRunById, getConnection, readConnectionDetail } from "@undercroft/db/repos";

import { type DayBudget, dayBudgetFor } from "./dayBudget.ts";
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
): Promise<{
  accountId: string | null;
  scope: ConnectionScope | null;
  granted: string;
  resync: ResyncSetting;
}> {
  const connection = await getConnection(deps.exec, input.tenantId, input.source);
  const detail = await readConnectionDetail(deps.exec, input.tenantId, input.source);
  const scope = detail === null ? null : parseScope(input.source, detail.selectionJson);
  const accountId = connection?.externalAccountId ?? null;
  return {
    accountId: accountId === "" ? null : accountId,
    scope,
    granted: connection?.scope ?? "",
    // No connection -- a spec that needs none -- re-syncs nothing, as a new connection does not.
    resync:
      connection === null
        ? { cadence: "paused", cron: null }
        : { cadence: connection.resyncCadence, cron: connection.resyncCron },
  };
}

/** How often the connection's lists are read whole again: its re-sync, ADR 0082. */
export interface ResyncSetting {
  readonly cadence: Cadence;
  readonly cron: string | null;
}

/**
 * The spec's entities as this connection's scope widens them, in spec order.
 *
 * Two scopes shape a spec run and they pull in opposite directions. Xero's NARROWS which
 * entities are read, where an empty list means every one; that is `partitionByGrant`'s to
 * apply, beside the grant, because the card needs the same narrowing to name the lists a
 * reconnect would add. HubSpot's WIDENS what each object read asks for, and never below what
 * the spec itself asks (`hubspot/properties.ts`). Any other scope, or none, reads the spec as it
 * is written. Between them these are the one place a scope reaches a spec run: the runtime is
 * handed the entities `openSpecRun` returns and never learns there was a choice.
 */
function widenedEntities(spec: ConnectorSpec, scope: ConnectionScope | null): ConnectorEntity[] {
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
  /** What decides whether a list is read whole this run: the re-sync, from this run's start. */
  readonly resync: ResyncSetting & { readonly runStartedAt: Date };
  /** What whole reads may spend of the provider's day, or `null` when the spec rations none. */
  readonly day: DayBudget | null;
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
  input: { source: string; tenantId: string; runId: string },
): Promise<SpecRun> {
  const spec = readSpec(deps.specsDir, input.source);
  const chosen = await chosenFor(deps, input);
  const run = await findRunById(deps.exec, input.runId);
  if (run === null) {
    // The ledger opened this run before anything read; a run with no row is a defect upstream.
    throw new Error(`run ${input.runId} has no ledger row to read its start from`);
  }

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

  const { granted, ungranted } = partitionByGrant(widenedEntities(spec, chosen.scope), {
    scope: chosen.scope,
    grantedScope: chosen.granted,
  });

  return {
    spec,
    ctx,
    entities: granted,
    ungranted,
    resync: { ...chosen.resync, runStartedAt: new Date(run.startedAt) },
    day: dayBudgetFor(spec),
  };
}
