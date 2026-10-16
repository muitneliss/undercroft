/**
 * What of a reader's row rules cannot hold against the tables standing now (ADR 0143), as
 * `ops.scope_faults` answers it (`repeatable/010_provision_tenant.sql`).
 *
 * The database decides, by the same function that writes the row policies (`ops.row_predicate`),
 * so what an administrator is told is broken and what the reader is shown -- no row of that table
 * -- cannot disagree. The control plane has no USAGE on a customer's analytics schema; the
 * function reads the catalogue for it, and reads no row.
 */

import type { ModelLimit } from "@undercroft/contracts/rowRules";
import type { SqlExecutor } from "@undercroft/db";

/**
 * Why a rule is broken: it names a column the table does not have, a value is not of its
 * column's type, or the model is a materialised view, which cannot carry a row policy.
 */
export type RuleFaultKind = "column-missing" | "value-type" | "not-a-table";

export interface RuleFault {
  readonly model: string;
  readonly fault: RuleFaultKind;
  /** The columns it names that the table lacks; empty for the other two. */
  readonly columns: readonly string[];
}

/** The broken row rules among `limits`, one per model; none for a model nothing is published of. */
export async function ruleFaults(
  exec: SqlExecutor,
  tenantId: string,
  limits: readonly ModelLimit[],
): Promise<RuleFault[]> {
  if (!limits.some((limit) => limit.rows !== null)) {
    return [];
  }
  const { rows } = await exec.query<{ model: string; fault: RuleFaultKind; columns: string[] }>(
    "SELECT model, fault, columns FROM ops.scope_faults($1, $2::text[], $3::jsonb) ORDER BY model",
    [tenantId, limits.map((limit) => limit.model), JSON.stringify(limits)],
  );
  return rows.map((row) => ({ model: row.model, fault: row.fault, columns: row.columns }));
}
