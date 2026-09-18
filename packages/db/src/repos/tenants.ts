/**
 * `ops.tenant`, for the callers below the control plane.
 *
 * The control plane has its own richer tenant repo; this is the one question the worker
 * needs to ask. Kept here rather than answered with a foreign-key violation because a
 * refusal a caller can name ("unknown tenant") is a 404, and a constraint violation is a
 * 500 that reads as a server fault.
 */

import type { SqlExecutor } from "../executor.ts";

export async function tenantExists(exec: SqlExecutor, tenantId: string): Promise<boolean> {
  const { rows } = await exec.query<{ id: string }>("SELECT id FROM ops.tenant WHERE id = $1", [
    tenantId,
  ]);
  return rows.length > 0;
}
