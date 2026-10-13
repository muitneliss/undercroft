/**
 * The customer's reference tables -- dbt seeds: listed, read, saved and deleted. ADR 0128.
 *
 * A seed is how a tenant keeps a small table by hand -- accounts mapped to groups, the people a
 * reviewer listed -- and reads it from every model that needs it with `ref()`, rather than
 * carrying it inside a model's SQL as `VALUES` and sending the whole model again for one changed
 * row. The worker renders every seed into each build and loads the ones its selection reaches.
 *
 * Save stores and runs nothing, like a model's. Unlike a model's, it REFUSES: a cell that is not
 * a value of its column's declared type, or one dbt would load as a different value, is never
 * stored (`seedRefusal`, `@undercroft/contracts`), because the build that found out would load a
 * NULL or a rounded figure into a table a dashboard reads and say it succeeded. The refusal
 * names the row and the column.
 *
 * A seed and a model may not share a name, either way round: both are relations of the tenant's
 * analytics schema and both are what `ref('name')` reads, and dbt refuses a project holding the
 * two -- so every build of the tenant would fail on it. The name is refused here instead, in
 * words, before it is stored. Two saves racing past this check meet that same refusal from dbt,
 * which fails loudly rather than reading the wrong one.
 *
 * Delete refuses while a model reads the seed -- by `ref()`, in its own text or through a macro
 * it calls -- naming the models, as a macro's delete does: their next build would fail on it.
 * Otherwise the seed's TABLE goes first, through the worker, as a model's does (ADR 0077), and
 * the row only after.
 *
 * The audit row names the seed and who saved it, never a cell: the cells are in the table.
 */

import { type SeedColumn, type SeedRefusal, seedRefusal } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import {
  deleteSeedUnlessBuilding,
  getModel,
  getSeed,
  insertSeed,
  listMacros,
  listModels,
  listSeedSummaries,
  type SeedColumnJson,
  type SeedSummary,
  saveSeed,
  seedExists,
} from "@undercroft/db/repos";
import { modelLineage } from "@undercroft/db/services";

import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import { mapNarrowed, type NameFilter, type Narrowed, narrowByName } from "./listFilter.ts";
import type { WorkerClient } from "./workerClient.ts";

/** One seed on the list: its name, its size, who last saved it and the hash of what it holds. */
export interface SeedItem {
  readonly name: string;
  readonly columnCount: number;
  readonly rowCount: number;
  readonly updatedBy: string;
  readonly updatedAt: string;
  /**
   * Hex SHA-256 of the stored columns and rows as Postgres prints them. Compare it with one this
   * platform gave before: equal means the table is the one you last read or wrote.
   */
  readonly sha256: string;
}

/** One seed whole: its declared columns and every row, each cell a string or `null`. */
export type SeedDetail = SeedItem & {
  /** As stored, which is as `seeds.save` admitted them: each type one of `SEED_COLUMN_TYPES`. */
  readonly columns: readonly SeedColumnJson[];
  readonly rows: readonly (readonly (string | null)[])[];
};

function item(seed: SeedSummary): SeedItem {
  return {
    name: seed.name,
    columnCount: seed.columnCount,
    rowCount: seed.rowCount,
    updatedBy: seed.updatedBy,
    updatedAt: seed.updatedAt,
    sha256: seed.sha256,
  };
}

/** The tenant's seeds, without their cells, narrowed by `filter` (`listFilter.ts`). */
export async function list(
  exec: SqlExecutor,
  tenantId: string,
  filter: NameFilter = {},
): Promise<Narrowed<SeedItem>> {
  const seeds = await listSeedSummaries(exec, tenantId);
  return mapNarrowed(
    narrowByName(seeds, (seed) => seed.name, filter),
    item,
  );
}

export async function get(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
): Promise<SeedDetail | null> {
  const seed = await getSeed(exec, tenantId, name);
  return seed === null ? null : { ...item(seed), columns: seed.columns, rows: seed.rows };
}

export type SaveOutcome =
  | { readonly ok: true; readonly unchanged: boolean }
  | { readonly ok: false; readonly reason: "name-taken" | "model-named" }
  | { readonly ok: false; readonly reason: "refused"; readonly refusal: SeedRefusal };

/**
 * Store the seed, if every cell is one its column may hold. With `create`, a name already in use
 * is refused and nothing is written. A table identical to the one stored is `unchanged`,
 * written and recorded nowhere, as a model's is (`models.ts`, ADR 0127).
 */
export async function save(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    name: string;
    columns: readonly SeedColumn[];
    rows: readonly (readonly (string | null)[])[];
    create: boolean;
    actor: Actor;
    actorId: string;
  },
): Promise<SaveOutcome> {
  const refusal = seedRefusal({ columns: input.columns, rows: input.rows });
  if (refusal !== null) {
    return { ok: false, reason: "refused", refusal };
  }
  if ((await getModel(exec, input.tenantId, input.name)) !== null) {
    return { ok: false, reason: "model-named" };
  }
  const seed = {
    name: input.name,
    columns: input.columns,
    rows: input.rows,
    updatedBy: input.actorId,
  };
  const result = input.create
    ? (await insertSeed(exec, input.tenantId, seed))
      ? "written"
      : "name-taken"
    : await saveSeed(exec, input.tenantId, seed);
  if (result === "name-taken") {
    return { ok: false, reason: "name-taken" };
  }
  if (result === "written") {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "seeds.save",
      detail: JSON.stringify({ name: input.name, created: input.create }),
    });
  }
  return { ok: true, unchanged: result === "unchanged" };
}

/**
 * The tenant's models that read `seed` by `ref()`, in their own text or through a macro they
 * call, as the lineage reads them -- one reading of "who depends on this", not a second one.
 */
async function readersOf(exec: SqlExecutor, tenantId: string, seed: string): Promise<string[]> {
  const [models, macros, seeds] = await Promise.all([
    listModels(exec, tenantId),
    listMacros(exec, tenantId),
    listSeedSummaries(exec, tenantId),
  ]);
  const graph = modelLineage({ models, macros, seeds: seeds.map((s) => s.name) });
  const node = graph.nodes.find((n) => n.kind === "seed" && n.name === seed);
  if (node === undefined) {
    return [];
  }
  const readers = graph.edges.filter((edge) => edge.from === node.id).map((edge) => edge.to);
  return graph.nodes
    .filter((n) => n.kind === "model" && readers.includes(n.id))
    .map((n) => n.name);
}

export type RemoveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not-found" | "in-progress" | "not-dropped" }
  | { readonly ok: false; readonly reason: "depended-on"; readonly dependents: readonly string[] };

/**
 * Remove the seed AND the table its loads made, or neither, unless a model still reads it.
 *
 * The models are asked first, from their text: a ref the drop could not see -- a model built as
 * a table reads nothing Postgres records -- would fail that model's next build. Then the table,
 * through the worker, as the tenant's dbt login, refusing on a view that reads it (ADR 0077).
 * The row goes last, conditional on no build running, for the reason a model's does.
 */
export async function remove(
  exec: SqlExecutor,
  worker: WorkerClient,
  input: { tenantId: string; name: string; actor: Actor },
): Promise<RemoveOutcome> {
  if (!(await seedExists(exec, input.tenantId, input.name))) {
    return { ok: false, reason: "not-found" };
  }
  const readers = await readersOf(exec, input.tenantId, input.name);
  if (readers.length > 0) {
    return { ok: false, reason: "depended-on", dependents: readers };
  }
  const drop = await worker.dropSeed({ tenantId: input.tenantId, seed: input.name });
  if (!drop.ok) {
    if (drop.reason === "depended-on") {
      return drop;
    }
    return { ok: false, reason: drop.reason === "in-progress" ? "in-progress" : "not-dropped" };
  }
  const deleted = await deleteSeedUnlessBuilding(exec, input.tenantId, input.name);
  if (deleted !== "deleted") {
    return { ok: false, reason: deleted === "building" ? "in-progress" : "not-found" };
  }
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "seeds.delete",
    detail: JSON.stringify({
      name: input.name,
      dropped: drop.value.dropped.map((r) => `${r.schema}.${r.name}`),
    }),
  });
  return { ok: true };
}
