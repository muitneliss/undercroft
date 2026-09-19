/**
 * A look at a relation as a tenant: its columns and its first rows, as the browser draws
 * them. Used for a model's preview after a build and for the rows a failed test stored.
 *
 * Cells cross the wire as strings, numbers, booleans or null. A `numeric` or a `bigint`
 * arrives from the driver as a STRING -- the pinned parsers in `@undercroft/db` -- and stays
 * one; an instant becomes ISO text; a jsonb value becomes its JSON text. Nothing here turns
 * an amount into a float, and nothing here guesses at a value it cannot represent.
 */

import type { Cell, TableResult } from "@undercroft/contracts";

import { columnsOf, firstRows } from "../repos/relations.ts";
import type { SessionTarget, TenantSessions } from "./tenantSession.ts";

function cellOf(value: unknown): Cell {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return JSON.stringify(value);
}

/** The relation's columns and its first `limit` rows, read as the tenant's `kind` login. */
export function readRelation(
  sessions: TenantSessions,
  target: SessionTarget & { schema: string; relation: string; limit: number },
): Promise<TableResult> {
  return sessions.as(target, async (exec) => {
    const columns = await columnsOf(exec, target.schema, target.relation);
    const rows = await firstRows(exec, {
      schema: target.schema,
      relation: target.relation,
      columns,
      limit: target.limit,
    });
    return {
      columns,
      rows: rows.slice(0, target.limit).map((row) => row.map(cellOf)),
      truncated: rows.length > target.limit,
    };
  });
}
