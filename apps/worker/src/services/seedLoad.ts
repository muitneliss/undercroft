/**
 * How a build loads a tenant's seeds: which of them its selection reaches, and how each is
 * loaded. ADR 0128.
 *
 * WHICH. A build of `stg_deals` that reads `ref('account_groups')` needs that seed loaded first,
 * or it reads whatever table the last load left -- or none. dbt does not add a model's parents to
 * a selection by itself, so each selector the build was asked for brings the seeds it reaches,
 * through dbt's own graph rather than a second reading of the models' text here:
 *
 * - `name` brings the seeds it reads directly: `1+name,resource_type:seed`. A seed has no parents,
 *   so every seed a model reads is one step above it.
 * - `+name` builds every model upstream, so it brings every seed upstream: `+name,resource_type:seed`.
 * - `name+` builds every model downstream, each of which may read a seed of its own:
 *   `@name,resource_type:seed`, the seeds above anything the selection builds. That reaches a
 *   seed only an unbuilt ancestor reads as well; loading it again changes nothing.
 *
 * `,` is dbt's intersection and `resource_type` its method, both in dbt 1.9's selector grammar
 * (`graph/cli.py`, `graph/selector_methods.py`). A build with no selection is the whole project,
 * every seed included, and so is a tenant with no seeds (`withSeedSelectors`).
 *
 * HOW. dbt loads an existing seed table by truncating it and inserting the file's rows. That is
 * right while the table has exactly the declared columns, and wrong the moment it does not: an
 * added or renamed column fails the insert, a removed one stays standing as NULLs, and a changed
 * type casts every cell into the OLD type -- a numeric column turned to text keeps rounding. So
 * a seed whose standing table differs from its declaration, in names, order or types, is loaded
 * with a full refresh: dropped and created again from the declaration. dbt drops it CASCADE,
 * which removes a view another model built over it until that model builds again; that happens
 * only when the table's shape has changed, which no such view would have survived either.
 */

import { type SeedColumnType, seedCsv } from "@undercroft/contracts";
import type { Seed } from "@undercroft/db/repos";
import type { ProjectSeed } from "@undercroft/db/services";

import { type Column, declaredColumnsOf } from "../repos/relations.ts";
import type { TenantSessions } from "./tenantSession.ts";

/** Each declared type as `format_type` prints the column dbt creates for it. */
const STANDING_TYPE: ReadonlyMap<string, string> = new Map(
  Object.entries({
    text: "text",
    integer: "integer",
    bigint: "bigint",
    "numeric(18,4)": "numeric(18,4)",
    boolean: "boolean",
    date: "date",
    timestamptz: "timestamp with time zone",
  } satisfies Record<SeedColumnType, string>),
);

/** The seeds a selection's selectors reach, as dbt selectors, one per argv item. */
function seedSelectors(select: readonly string[]): string[] {
  return select.map((selector) => {
    if (selector.endsWith("+")) {
      return `@${selector.slice(0, -1)},resource_type:seed`;
    }
    return selector.startsWith("+")
      ? `${selector},resource_type:seed`
      : `1+${selector},resource_type:seed`;
  });
}

/**
 * A build's request with the seeds its selection reaches added to that selection, or the request
 * as it was: for a build of everything, or a tenant with no seeds -- `resource_type:seed` matching
 * nothing is a warning in dbt's log, and would load nothing anyway.
 */
export function withSeedSelectors<Input extends { readonly select?: readonly string[] }>(
  input: Input,
  hasSeeds: boolean,
): Input {
  if (input.select === undefined || !hasSeeds) {
    return input;
  }
  return { ...input, select: [...input.select, ...seedSelectors(input.select)] };
}

/** Whether the standing table is exactly the declaration: same names, same order, same types. */
function matches(seed: Seed, standing: readonly Column[]): boolean {
  return (
    standing.length === seed.columns.length &&
    seed.columns.every(
      (column, at) =>
        standing[at]?.name === column.name &&
        standing[at]?.type === (STANDING_TYPE.get(column.type) ?? column.type),
    )
  );
}

/**
 * The tenant's seeds as the project carries them: each one's file, and whether its standing
 * table in staging, read as the tenant's dbt login, needs a full refresh. Promotion moves a
 * loaded table out of staging (ADR 0131), so a standing one is a load that was held back. A seed never loaded has no table
 * and is created by its first load, as dbt does.
 */
export async function projectSeeds(
  sessions: TenantSessions,
  /** `schema` is where the build loads its seeds: the tenant's staging schema (ADR 0131). */
  input: { tenantId: string; schema: string; seeds: readonly Seed[] },
): Promise<ProjectSeed[]> {
  if (input.seeds.length === 0) {
    return [];
  }
  const standing = await sessions.as({ tenantId: input.tenantId, kind: "dbt" }, (exec) =>
    declaredColumnsOf(
      exec,
      input.schema,
      input.seeds.map((seed) => seed.name),
    ),
  );
  return input.seeds.map((seed) => {
    const table = standing.get(seed.name);
    return {
      name: seed.name,
      columns: seed.columns,
      csv: seedCsv(seed),
      fullRefresh: table !== undefined && !matches(seed, table),
    };
  });
}
