/**
 * `ops.tenant`: the customer record, with no secret material in it.
 *
 * Reads only. A tenant is created by an operator applying SQL, not by an endpoint, so there
 * is deliberately no writer here to call by accident.
 */

import type { SqlExecutor } from "@undercroft/db";

export interface Tenant {
  readonly id: string;
  readonly displayName: string;
}

/** One tenant, or `null`. Whether "absent" is a 404 is the caller's decision. */
export async function findTenant(exec: SqlExecutor, tenantId: string): Promise<Tenant | null> {
  const { rows } = await exec.query<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM ops.tenant WHERE id = $1",
    [tenantId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: row.id, displayName: row.display_name };
}
