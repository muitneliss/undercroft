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

/**
 * The raw lake, queried directly: the SAME frame, as the tenant's dbt login.
 *
 * WHY A SECOND ENTRY POINT AND NOT A FLAG ON THE FIRST. The two differ in the only thing
 * that matters -- which login runs them -- and that is a security boundary rather than a
 * parameter. `runQuery` answers a dashboard as the BI login, which has no USAGE on `raw` at
 * all and is the reason a chart can never reach an unreviewed payload. This answers an
 * admin's own console as the dbt login, which `ops.provision_tenant` grants SELECT on
 * `raw.records`, `raw.documents` and `raw.document_text`. Naming them separately is what
 * keeps a later caller from reaching the wider login by passing a string.
 *
 * WHAT MAKES IT SAFE is the frame and Postgres, not this function. `SET TRANSACTION READ
 * ONLY` refuses every write before a grant is consulted -- which matters here in a way it
 * does not for BI, because the dbt login CAN create in its own two schemas, and read-only is
 * what takes that away for the length of the query. The dbt login has no USAGE on `app` or
 * `ops`, so no credential is reachable; the row-level policy on `raw` shows it one tenant's
 * rows; and the extended protocol with an empty parameter list makes `; DROP TABLE` a syntax
 * error rather than a second statement.
 */
export async function runRawQuery(
  deps: QueryDeps,
  input: { tenantId: string; sql: string; limit: number; offset?: number },
): Promise<TableResult> {
  const roles = await tenantRolesFor(deps.exec, input.tenantId);
  if (roles === null) {
    throw new TenantNotProvisioned(input.tenantId);
  }
  return deps.sessions.as({ tenantId: input.tenantId, kind: "dbt" }, async (exec) => {
    let framed: Awaited<ReturnType<typeof runFramed>>;
    try {
      framed = await runFramed(exec, {
        schema: RAW_SCHEMA,
        sql: input.sql,
        limit: input.limit,
        offset: input.offset ?? 0,
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

/**
 * The lake's own schema, so an unqualified `documents` means `raw.documents`.
 *
 * Not the tenant's analytics schema and not both: a console over the raw lake that silently
 * resolved a name in `analytics_<slug>` would answer a question about transformed data with
 * a table the author believed was raw. A model is still reachable by writing its schema out.
 */
const RAW_SCHEMA = "raw";

/** Every table and column the dbt login can see in `raw`. The console's own sidebar. */
export function readRawSchema(
  deps: QueryDeps,
  input: { tenantId: string },
): Promise<SchemaResponse> {
  return rawSchemaOf(deps, input);
}

async function rawSchemaOf(deps: QueryDeps, input: { tenantId: string }): Promise<SchemaResponse> {
  const roles = await tenantRolesFor(deps.exec, input.tenantId);
  if (roles === null) {
    throw new TenantNotProvisioned(input.tenantId);
  }
  const rows = await deps.sessions.as({ tenantId: input.tenantId, kind: "dbt" }, (exec) =>
    schemaColumns(exec, RAW_SCHEMA),
  );
  const tables = new Map<string, { name: string; type: string }[]>();
  for (const row of rows) {
    const columns = tables.get(row.table_name) ?? [];
    columns.push({ name: row.column_name, type: row.data_type });
    tables.set(row.table_name, columns);
  }
  return { tables: [...tables].map(([name, columns]) => ({ name, columns })) };
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
