/**
 * The query runner: SQL an author wrote, answered as the tenant's read-only login.
 *
 * The worker runs it, not the control plane, for the reason ADR 0016 gives about
 * credentials extended to data: the worker is the one process that can mint a tenant
 * login's password, so a compromised control plane still cannot obtain any tenant's
 * database login. The control plane asks; this answers with rows and nothing else.
 *
 * What makes it safe to run a stranger's SQL is Postgres, not this module: the login has
 * SELECT on the tenant's analytics schema and no USAGE on `raw`, `app`, `ops` or `dq`, the
 * row-level policy on `raw` would show it nothing even if it had, and the frame in
 * `repos/queries.ts` makes the transaction read-only and the statement singular. This
 * module turns a driver result into the wire shape and a driver error into a refusal the
 * author can read.
 *
 * A `numeric` or a `bigint` cell is a STRING here and stays one to the screen: the pinned
 * parsers in `@undercroft/db`, all the way through.
 */

// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

import type { SchemaResponse, TableResult } from "@undercroft/contracts";
import { UndercroftError } from "@undercroft/core";
import { tenantRolesFor } from "@undercroft/db/repos";

import { runFramed, schemaColumns, typeNames } from "../repos/queries.ts";
import { cellOf } from "./preview.ts";
import { TenantNotProvisioned, type TenantSessions } from "./tenantSession.ts";

/** How long one query may run. A dashboard tile, not a batch job. */
export const QUERY_TIMEOUT_MS = 15_000;

/**
 * The author's SQL did not run: a syntax error, a table the login cannot see, a write in a
 * read-only transaction. Carries Postgres's own sentence, which quotes the author's text and
 * nothing else; a refusal an author can act on has to say what was refused.
 */
export class QueryFailed extends UndercroftError {}

export interface QueryDeps {
  readonly sessions: TenantSessions;
  readonly exec: import("@undercroft/db").SqlExecutor;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run one SELECT as the tenant's BI login and answer with up to `limit` rows. */
export async function runQuery(
  deps: QueryDeps,
  input: { tenantId: string; sql: string; limit: number },
): Promise<TableResult> {
  const roles = await tenantRolesFor(deps.exec, input.tenantId);
  if (roles === null) {
    throw new TenantNotProvisioned(input.tenantId);
  }
  return deps.sessions.as({ tenantId: input.tenantId, kind: "bi" }, async (exec) => {
    let framed: Awaited<ReturnType<typeof runFramed>>;
    try {
      framed = await runFramed(exec, {
        schema: roles.analyticsSchema,
        sql: input.sql,
        limit: input.limit,
        timeoutMs: QUERY_TIMEOUT_MS,
      });
    } catch (error) {
      throw new QueryFailed(messageOf(error), { cause: error });
    }
    const names = await typeNames(
      exec,
      framed.fields.map((f) => f.dataTypeID),
    );
    const columns = framed.fields.map((f) => ({
      name: f.name,
      type: names.get(f.dataTypeID) ?? String(f.dataTypeID),
    }));
    const rows = framed.rows
      .slice(0, input.limit)
      .map((row) => columns.map((column) => cellOf(row[column.name])));
    return { columns, rows, truncated: framed.rows.length > input.limit };
  });
}

/** The tenant's analytics schema as its BI login sees it. */
export async function readSchema(
  deps: QueryDeps,
  input: { tenantId: string },
): Promise<SchemaResponse> {
  const roles = await tenantRolesFor(deps.exec, input.tenantId);
  if (roles === null) {
    throw new TenantNotProvisioned(input.tenantId);
  }
  const rows = await deps.sessions.as({ tenantId: input.tenantId, kind: "bi" }, (exec) =>
    schemaColumns(exec, roles.analyticsSchema),
  );
  const tables = new Map<string, { name: string; type: string }[]>();
  for (const row of rows) {
    const columns = tables.get(row.table_name) ?? [];
    columns.push({ name: row.column_name, type: row.data_type });
    tables.set(row.table_name, columns);
  }
  return { tables: [...tables].map(([name, columns]) => ({ name, columns })) };
}
