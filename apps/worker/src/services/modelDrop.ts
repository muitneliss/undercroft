/**
 * Dropping what a model built, as the tenant login that built it. ADR 0077.
 *
 * A model's row is only its SQL. What a person deleting it cares about is the data, and that
 * is in the tenant's schemas: the relation dbt built in `analytics_<slug>`, which every
 * dashboard reads, and the failing rows its tests stored in `dq_<slug>`, which are source rows
 * verbatim. Deleting the row alone left both readable indefinitely, because nothing else ever
 * removes a relation -- dbt replaces what it builds and never drops what it no longer builds.
 * So the control plane asks for this BEFORE it deletes the row, and deletes nothing when this
 * does not answer.
 *
 * WHY HERE. Only the owner of a relation may drop it, and the owner is the tenant's dbt login,
 * whose password only the worker can mint (ADR 0016). No grant is involved and none is added:
 * the login drops what it made, in the two schemas it owns.
 *
 * WHAT IS DROPPED is decided against the catalogue, by name, and never from the ledger: a
 * relation left by a model deleted before this existed is found the same way as one built
 * this morning, so re-creating a model of the same name and deleting it clears the leftover.
 * `relationsOfModel` says what dbt names things; `relationsToDrop` says which of the relations
 * that exist belong to THIS model and to no other, because two models' names can share a
 * prefix and a test's failing-rows table is named `<kind>_<model>_<column>`.
 *
 * WHAT IS REFUSED, and why nothing is dropped when it is:
 * - A build of the tenant is running. It read every model when it started and would build
 *   this one again after the drop, leaving a table whose model is gone.
 * - Another relation reads from one of these -- another model built as a view. The drop is
 *   RESTRICT, never CASCADE: a person deleting one model has not decided to delete another,
 *   and the refusal names the dependents so they can.
 * All drops are one transaction, so a refusal or a failure part-way leaves everything as it was.
 */

import { TEST_KINDS } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import {
  listModels,
  type ModelTestsJson,
  runningRun,
  SOURCE_OF_TRANSFORM,
  tenantRolesFor,
} from "@undercroft/db/repos";
import { relationsOfModel, testRelationPrefix } from "@undercroft/db/services";

import {
  dependentsOf,
  dropRelation,
  inTransaction,
  type Relation,
  relationsIn,
} from "../repos/relations.ts";
import { RunInProgress } from "./ingest.ts";
import type { TenantSessions } from "./tenantSession.ts";

export interface DropDeps {
  readonly exec: SqlExecutor;
  readonly sessions: TenantSessions;
}

export type DropOutcome =
  | { readonly ok: true; readonly dropped: Relation[] }
  | { readonly ok: false; readonly reason: "depended-on"; readonly dependents: Relation[] };

interface ModelShape {
  readonly name: string;
  readonly tests: ModelTestsJson;
}

/**
 * Drop every relation the tenant's `model` left behind, or refuse and drop none.
 *
 * Throws `RunInProgress` while a build of the tenant runs. A tenant never provisioned has no
 * login and so no relation, and answers with nothing dropped.
 */
export async function dropModelRelations(
  deps: DropDeps,
  input: { tenantId: string; model: string },
): Promise<DropOutcome> {
  const roles = await tenantRolesFor(deps.exec, input.tenantId);
  if (roles === null) {
    return { ok: true, dropped: [] };
  }
  const building = await runningRun(deps.exec, {
    tenantId: input.tenantId,
    source: SOURCE_OF_TRANSFORM,
    verb: "transform",
  });
  if (building !== null) {
    throw new RunInProgress("transform", input.tenantId, building);
  }
  const models = await listModels(deps.exec, input.tenantId);
  // The row is normally still there -- the control plane deletes it after this answers. A
  // model already gone is dropped by its name alone: its declared tests are not known.
  const own = models.find((m) => m.name === input.model) ?? {
    name: input.model,
    tests: { columns: {} },
  };
  const others = models.filter((m) => m.name !== input.model);

  return deps.sessions.as({ tenantId: input.tenantId, kind: "dbt" }, (exec) =>
    inTransaction(exec, async (): Promise<DropOutcome> => {
      const present = await relationsIn(exec, [roles.analyticsSchema, roles.dqSchema]);
      const doomed = relationsToDrop(own, others, present, {
        analytics: roles.analyticsSchema,
        dq: roles.dqSchema,
      });
      const blocking = await dependentsOutside(exec, doomed);
      if (blocking.length > 0) {
        return { ok: false, reason: "depended-on", dependents: blocking };
      }
      for (const relation of doomed) {
        await dropRelation(exec, relation);
      }
      return { ok: true, dropped: doomed };
    }),
  );
}

/** What reads from any of `doomed` and is not itself about to go. */
async function dependentsOutside(exec: SqlExecutor, doomed: Relation[]): Promise<Relation[]> {
  const going = new Set(doomed.map(keyOf));
  const found = new Map<string, Relation>();
  for (const relation of doomed) {
    for (const dependent of await dependentsOf(exec, relation)) {
      if (!going.has(keyOf(dependent))) {
        found.set(keyOf(dependent), dependent);
      }
    }
  }
  return [...found.values()];
}

function keyOf(relation: Pick<Relation, "schema" | "name">): string {
  return `${relation.schema}.${relation.name}`;
}

/**
 * Which of the relations present belong to `model` and to no other model of the tenant.
 *
 * In `analytics`, the model's own name and dbt's two working copies of it, unless another
 * model has that name.
 *
 * In `dq`, a failing-rows table is the model's when one of its declared tests writes it and no
 * other model's does. Otherwise its name is read: `<kind>_<model>_...` belongs to the model
 * with the LONGEST name it starts with, because `not_null_stg_deals_id` is `stg_deals`'s test
 * of `id` as readily as `stg`'s test of `deals_id`, and only the longer reading can be a
 * declared test of a model the shorter one is not. That is what reaches the tables of tests an
 * author removed and of models deleted before this existed. A hashed name (a test name of 64
 * characters or more) is reachable only through a declared test.
 */
function relationsToDrop(
  model: ModelShape,
  others: readonly ModelShape[],
  present: readonly Relation[],
  schemas: { readonly analytics: string; readonly dq: string },
): Relation[] {
  const ours = relationsOfModel(model);
  const theirs = others.map((other) => relationsOfModel(other));
  const theirTables = new Set(theirs.flatMap((r) => r.analytics));
  const theirTests = new Set(theirs.flatMap((r) => r.dq));
  const everyone = [model, ...others];

  return present.filter((relation) => {
    if (relation.schema === schemas.analytics) {
      return ours.analytics.includes(relation.name) && !theirTables.has(relation.name);
    }
    if (relation.schema !== schemas.dq || theirTests.has(relation.name)) {
      return false;
    }
    return ours.dq.includes(relation.name) || ownerByName(relation.name, everyone) === model.name;
  });
}

/** The model with the longest name that `<kind>_<name>_` starts `relation` for, if any. */
function ownerByName(relation: string, models: readonly ModelShape[]): string | null {
  let owner: string | null = null;
  for (const candidate of models) {
    const matches = TEST_KINDS.some((kind) =>
      relation.startsWith(testRelationPrefix(kind, candidate.name)),
    );
    if (matches && (owner === null || candidate.name.length > owner.length)) {
      owner = candidate.name;
    }
  }
  return owner;
}
