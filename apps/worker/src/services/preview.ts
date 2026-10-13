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
import { describeError, type Logger } from "@undercroft/core";

import { inReadOnlyTransaction } from "../repos/queries.ts";
import { columnsOf, countRows, firstRows } from "../repos/relations.ts";
import type { SessionTarget, TenantSessions } from "./tenantSession.ts";

export function cellOf(value: unknown): Cell {
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

/**
 * How many rows each relation holds, as the tenant's `kind` login counts them -- or `null` for
 * one it could not count: a login refused, a relation that is not there, a count still running
 * when the budget ran out. Never `0` for any of those, because a zero is a real answer.
 *
 * One session for all of them, and one budget: every count runs in a read-only transaction of
 * its own whose statement timeout is what is left of `budgetMs`, so a slow table cuts its own
 * count and the next one still runs, and the whole never takes longer than the budget. A build
 * names at most twenty models; twenty full-length timeouts would outlast the request waiting.
 */
export async function countRelations(
  sessions: TenantSessions,
  target: SessionTarget & { schema: string; relations: readonly string[]; budgetMs: number },
  log?: Logger,
): Promise<Map<string, number | null>> {
  const counts = new Map<string, number | null>(target.relations.map((name) => [name, null]));
  if (target.relations.length === 0) {
    return counts;
  }
  const deadline = Date.now() + target.budgetMs;
  try {
    await sessions.as(target, async (exec) => {
      for (const relation of target.relations) {
        const left = deadline - Date.now();
        if (left <= 0) {
          log?.warn("row_count_unread", { relation, reason: "budget" });
          continue;
        }
        try {
          const rows = await inReadOnlyTransaction(exec, { timeoutMs: left }, () =>
            countRows(exec, { schema: target.schema, relation }),
          );
          counts.set(relation, rows);
        } catch (error) {
          log?.warn("row_count_unread", { relation, ...describeError(error) });
        }
      }
    });
  } catch (error) {
    // No session at all -- the login was busy, or refused. Every count stays unread.
    log?.warn("row_count_unread", { relations: target.relations.length, ...describeError(error) });
  }
  return counts;
}
