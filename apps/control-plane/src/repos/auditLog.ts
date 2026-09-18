/**
 * `ops.audit_log`: append-only, who did what to which tenant.
 *
 * Write-only from the application's side. Nothing in the product reads it back yet, which
 * is precisely why it must not become a convenience table with an update path -- an audit
 * trail that can be edited is a story, not evidence.
 *
 * `detail` is passed in already serialised: what is worth recording about an action is the
 * action's business, and a repo that reached into a payload to decide would be deciding.
 */

import type { SqlExecutor } from "@undercroft/db";

export async function record(
  exec: SqlExecutor,
  entry: { tenantId: string; actor: string; action: string; detail: string },
): Promise<void> {
  await exec.query(
    `INSERT INTO ops.audit_log (tenant_id, actor, action, detail)
     VALUES ($1, $2, $3, $4)`,
    [entry.tenantId, entry.actor, entry.action, entry.detail],
  );
}
