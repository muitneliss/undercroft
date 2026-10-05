/**
 * `ops.tenant`, for the callers below the control plane.
 *
 * The control plane has its own richer tenant repo; these are the questions the worker and the
 * alert tick need to ask. `tenantExists` is kept here rather than answered with a foreign-key
 * violation because a refusal a caller can name ("unknown tenant") is a 404, and a constraint
 * violation is a 500 that reads as a server fault.
 */

import type { SqlExecutor } from "../executor.ts";

export async function tenantExists(exec: SqlExecutor, tenantId: string): Promise<boolean> {
  const { rows } = await exec.query<{ id: string }>("SELECT id FROM ops.tenant WHERE id = $1", [
    tenantId,
  ]);
  return rows.length > 0;
}

/**
 * The customers that are deactivated now (ADR 0110), by id.
 *
 * A set rather than a per-tenant question, because its callers hold a list -- the pairs a
 * scheduler tick found due, the notices an alert tick claimed -- and one read answers all of
 * them. It answers, it does not judge: what a deactivated customer means to a list is the
 * caller's to say, and each says it out loud rather than dropping the rows quietly.
 */
export async function deactivatedTenants(exec: SqlExecutor): Promise<ReadonlySet<string>> {
  const { rows } = await exec.query<{ id: string }>(
    "SELECT id FROM ops.tenant WHERE deactivated_at IS NOT NULL",
  );
  return new Set(rows.map((row) => row.id));
}
