/**
 * What a tenant has connected, for the operator UI.
 *
 * A thin pass to `@undercroft/db/repos`, and worth existing anyway: the registry is a repo,
 * so the router may not reach it directly (`layer-handler-no-repo`), and this is where the
 * next thing the UI needs -- a derived "needs attention" flag, a status the BI role may not
 * see -- will go without the handler growing a decision.
 *
 * Nothing here opens a credential. `app.connection_secret` is reachable only through
 * `@undercroft/db/services`, from the worker, which holds the master key; the control plane
 * shows status and never sees a token.
 */

// biome-ignore-all lint/style/noExportedImports: Re-exporting an imported type from a package entry point is what makes the entry point complete. Without it a consumer imports the value from one path and its type from another.

import type { SqlExecutor } from "@undercroft/db";
import { type Connection, getConnection, listConnections } from "@undercroft/db/repos";

export type { Connection };

export function list(exec: SqlExecutor, tenantId: string): Promise<Connection[]> {
  return listConnections(exec, tenantId);
}

export function get(
  exec: SqlExecutor,
  tenantId: string,
  source: string,
): Promise<Connection | null> {
  return getConnection(exec, tenantId, source);
}
