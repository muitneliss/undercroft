/**
 * Previewing a user-authored dbt model.
 *
 * The rows come back exactly as the database typed them -- money as a string, never a
 * number. That is held by `pinTypeParsers` at the pool and asserted by a test; this layer's
 * job is to not undo it, which means no mapping, no rounding and no `Number()` on the way
 * out. `.claude/rules/money.md`.
 */

import type { SqlExecutor } from "@undercroft/db";
import { previewTable } from "../repos/analytics.ts";

export function preview(exec: SqlExecutor, table: string): Promise<Record<string, unknown>[]> {
  return previewTable(exec, table);
}
