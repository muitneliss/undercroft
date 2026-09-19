/**
 * Which filter operators a column can take, from the Postgres type the schema reports.
 *
 * A text column can contain a word and cannot be "between" two; a number or an instant
 * can be compared and bounded; a boolean is equal or not; a type this does not know --
 * jsonb, an array, a range -- offers no operator rather than one that would error at run
 * time in Postgres's words. `contains` is spelled `ILIKE` by the compiler, case-folded,
 * because a person filtering for a name does not mean its capitalisation.
 */

// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: `is_null` and `not_null` are the filter operators as stored in a question and sent over the wire; the key is the value, and a camelCase spelling would be a second name for the same thing.

import type { FilterOp } from "@undercroft/contracts/bi";
import type { TFunction } from "i18next";

export type ColumnFamily = "text" | "number" | "time" | "boolean" | "other";

const TEXT = new Set(["text", "character varying", "character", "citext", "uuid", "name"]);
const NUMBER = new Set([
  "integer",
  "bigint",
  "smallint",
  "numeric",
  "real",
  "double precision",
  "money",
]);

/** The family a Postgres type name belongs to. `timestamp with time zone` is time. */
export function familyOf(pgType: string): ColumnFamily {
  if (TEXT.has(pgType)) {
    return "text";
  }
  if (NUMBER.has(pgType)) {
    return "number";
  }
  if (pgType === "boolean") {
    return "boolean";
  }
  if (pgType === "date" || pgType.startsWith("timestamp") || pgType.startsWith("time")) {
    return "time";
  }
  return "other";
}

const NULLNESS: readonly FilterOp[] = ["is_null", "not_null"];
const ORDERED: readonly FilterOp[] = ["eq", "neq", "lt", "lte", "gt", "gte", "between", "in"];

/** The operators a column of this type can take. Unknown types offer none. */
export function opsFor(pgType: string): FilterOp[] {
  const family = familyOf(pgType);
  switch (family) {
    case "text":
      return ["eq", "neq", "contains", "in", ...NULLNESS];
    case "number":
    case "time":
      return [...ORDERED, ...NULLNESS];
    case "boolean":
      return ["eq", "neq", ...NULLNESS];
    case "other":
      return [];
    default: {
      const exhaustive: never = family;
      throw new Error(`unhandled family ${String(exhaustive)}`);
    }
  }
}

/** How many values an operator takes: none, one, a pair, or a list. */
export function arityOf(op: FilterOp): "none" | "one" | "two" | "many" {
  switch (op) {
    case "is_null":
    case "not_null":
      return "none";
    case "between":
      return "two";
    case "in":
      return "many";
    default:
      return "one";
  }
}

const OP_KEY = {
  eq: "bi.opEq",
  neq: "bi.opNeq",
  lt: "bi.opLt",
  lte: "bi.opLte",
  gt: "bi.opGt",
  gte: "bi.opGte",
  contains: "bi.opContains",
  in: "bi.opIn",
  between: "bi.opBetween",
  is_null: "bi.opIsNull",
  not_null: "bi.opNotNull",
} as const;

export function opLabel(t: TFunction, op: FilterOp): string {
  return t(OP_KEY[op]);
}
