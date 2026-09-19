/**
 * Questions, as the Reports division defines them, and the one compiler that turns a
 * visual definition into SQL.
 *
 * A question is either a VISUAL definition -- a table, columns with optional aggregates,
 * filters, a grouping, an order, a limit -- or raw SQL. Both end as SQL the worker runs as
 * the tenant's read-only login (the query runner), so the compiler here is a text
 * function: definition in, SQL out, no database. It is tested by string equality here and
 * by execution as a tenant login in the worker's suite.
 *
 * Two things the compiler holds to:
 *
 * - **Every identifier is quoted.** A table or column name reaches the SQL as `"name"`
 *   with any inner quote doubled, after the contract has already refused anything that is
 *   not a plain identifier. Nothing an author names is ever spliced bare.
 * - **Every value is a literal, quoted the way Postgres quotes text.** Filters and bound
 *   parameters become `'value'` with inner quotes doubled; Postgres coerces the untyped
 *   literal to the column's type, so `"amount" > '100'` compares as numeric. The runner
 *   sends the SQL with an empty parameter list, and this is why it can.
 *
 * Parameters are `{{name}}` in SQL, or a filter whose value is exactly `{{name}}` in a
 * visual definition. A dashboard's filters bind them; a question run with one unbound is
 * refused rather than run with a guess.
 */

// biome-ignore-all lint/style/noExcessiveLinesPerFile: One contract, one file: the shape of a question, the shape of a dashboard, and the compiler that turns the one into SQL are three views of one agreement, and a reader checking that the compiler honours the shape wants them side by side rather than in three files that agree by convention.
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: `filterSql` is one switch over the eleven filter operators, each arm a line or three; splitting it by operator family would put the shape of one clause across three names.
// biome-ignore-all lint/style/noMagicNumbers: The bounds on a definition -- how long a name or a value, how many fields, filters or tiles, how wide the grid -- are the numbers themselves, read beside the field they bound; a constant per bound would be a second name for each with no meaning the number does not already carry.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: `not_null`, `is_null`, `date_range` and the chart type names are the words stored in a question's definition and sent over the wire; the key is the value, and a camelCase spelling would be a second name for the same thing.

import { z } from "zod";

import { DEFAULT_QUERY_ROWS, MAX_QUERY_ROWS, MAX_QUERY_SQL_BYTES } from "./transformApi.ts";

/** A table or column name as Postgres accepts it quoted: letters, digits, underscore. */
export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
export const Identifier = z.string().regex(IDENTIFIER).max(63);

export const AGGREGATES = ["count", "sum", "avg", "min", "max"] as const;
export const Aggregate = z.enum(AGGREGATES);
export type Aggregate = z.infer<typeof Aggregate>;

export const FILTER_OPS = [
  "eq",
  "neq",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "in",
  "between",
  "is_null",
  "not_null",
] as const;
export const FilterOp = z.enum(FILTER_OPS);
export type FilterOp = z.infer<typeof FilterOp>;

/** A filter's value: one literal, a list for `in`, a pair for `between`, none for null tests. */
export const Filter = z.object({
  column: Identifier,
  op: FilterOp,
  value: z.union([z.string().max(1000), z.array(z.string().max(1000)).max(100)]).optional(),
});
export type Filter = z.infer<typeof Filter>;

/** A column to select, aggregated or not. `*` is allowed for `count` alone. */
export const Field = z.object({
  column: z.union([Identifier, z.literal("*")]),
  aggregate: Aggregate.optional(),
  alias: Identifier.optional(),
});
export type Field = z.infer<typeof Field>;

export const Order = z.object({
  by: Identifier,
  dir: z.enum(["asc", "desc"]).default("asc"),
});

export const VisualDefinition = z.object({
  kind: z.literal("visual"),
  table: Identifier,
  fields: z.array(Field).min(1).max(50),
  filters: z.array(Filter).max(50).default([]),
  groupBy: z.array(Identifier).max(20).default([]),
  orderBy: z.array(Order).max(10).default([]),
  limit: z.number().int().min(1).max(MAX_QUERY_ROWS).default(DEFAULT_QUERY_ROWS),
});
export type VisualDefinition = z.infer<typeof VisualDefinition>;

export const SqlDefinition = z.object({
  kind: z.literal("sql"),
  sql: z.string().min(1).max(MAX_QUERY_SQL_BYTES),
});
export type SqlDefinition = z.infer<typeof SqlDefinition>;

export const QuestionDefinition = z.discriminatedUnion("kind", [VisualDefinition, SqlDefinition]);
export type QuestionDefinition = z.infer<typeof QuestionDefinition>;

/** Every way a question can be drawn. The browser owns what each means; this names them. */
export const CHART_TYPES = [
  "table",
  "number",
  "bar",
  "line",
  "area",
  "pie",
  "doughnut",
  "scatter",
  "bubble",
  "radar",
  "combo",
  "funnel",
  "gauge",
  "progress",
  "pivot",
  "map",
] as const;
export const ChartType = z.enum(CHART_TYPES);
export type ChartType = z.infer<typeof ChartType>;

/** How a question is drawn: the type, which columns feed which axis, and per-type options. */
export const ChartConfig = z.object({
  type: ChartType.default("table"),
  x: Identifier.optional(),
  y: z.array(Identifier).max(20).default([]),
  series: Identifier.optional(),
  options: z.record(z.string(), z.unknown()).default({}),
});
export type ChartConfig = z.infer<typeof ChartConfig>;

/** Bound values for a run: `{{name}}` -> value. A list is for `in`. */
export const QueryParams = z.record(
  Identifier,
  z.union([z.string().max(1000), z.array(z.string().max(1000)).max(100)]),
);
export type QueryParams = z.infer<typeof QueryParams>;

export const MAX_TILES = 50;

/** One question on a dashboard's twelve-column grid. */
export const DashboardTile = z.object({
  questionId: z.string().uuid(),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(1000),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(12),
});
export type DashboardTile = z.infer<typeof DashboardTile>;

export const DashboardLayout = z.object({
  tiles: z.array(DashboardTile).max(MAX_TILES).default([]),
});
export type DashboardLayout = z.infer<typeof DashboardLayout>;

/** A shared filter at the top of a dashboard, bound into every question that names it. */
export const DashboardFilter = z.object({
  name: Identifier,
  kind: z.enum(["date_range", "text", "number"]),
  label: z.string().min(1).max(80),
});
export type DashboardFilter = z.infer<typeof DashboardFilter>;

export const DashboardFilters = z.array(DashboardFilter).max(20);

// -- the compiler --------------------------------------------------------------------

/** `"name"`, with any quote in the name doubled. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** `'value'`, with any quote in the value doubled. Postgres coerces it to the column's type. */
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const PARAM = /\{\{\s*(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\}\}/gu;
const WHOLE_PARAM = /^\{\{\s*(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/u;

/** Every `{{name}}` in the text, once each, in order of first appearance. */
export function paramNames(sql: string): string[] {
  const names: string[] = [];
  for (const match of sql.matchAll(PARAM)) {
    const name = match.groups?.name;
    if (name !== undefined && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

export class ParamMissing extends Error {
  readonly param: string;

  constructor(param: string) {
    super(`the question needs a value for {{${param}}}`);
    this.name = "ParamMissing";
    this.param = param;
  }
}

/** A value, or a list of them, as a literal or a parenthesised list of literals. */
function literalOf(value: string | readonly string[]): string {
  return typeof value === "string"
    ? quoteLiteral(value)
    : `(${value.map(quoteLiteral).join(", ")})`;
}

/**
 * Replace every `{{name}}` with its bound value as a literal. A name with no value is a
 * refusal, not an empty string: a filter that silently matched everything is the kind of
 * wrong answer that looks right.
 */
export function bindParams(sql: string, params: QueryParams): string {
  return sql.replaceAll(PARAM, (_whole, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new ParamMissing(name);
    }
    return literalOf(value);
  });
}

/** A filter value as SQL: a parameter reference verbatim (bound later), else a literal. */
function valueSql(value: string): string {
  return WHOLE_PARAM.test(value) ? value.trim() : quoteLiteral(value);
}

function single(filter: Filter): string {
  const { value } = filter;
  if (typeof value !== "string") {
    throw new Error(`filter on ${filter.column} needs one value`);
  }
  return valueSql(value);
}

function containsSql(column: string, filter: Filter): string {
  const { value } = filter;
  if (typeof value !== "string") {
    throw new Error(`filter on ${filter.column} needs one value`);
  }
  // A parameter reference is bound whole; a literal is wrapped for ILIKE here.
  return WHOLE_PARAM.test(value)
    ? `${column}::text ILIKE ('%' || ${value.trim()} || '%')`
    : `${column}::text ILIKE ${quoteLiteral(`%${value}%`)}`;
}

function inSql(column: string, filter: Filter): string {
  const { value } = filter;
  if (typeof value === "string" && WHOLE_PARAM.test(value)) {
    return `${column} IN ${value.trim()}`;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`filter on ${filter.column} needs a list of values`);
  }
  return `${column} IN (${value.map(quoteLiteral).join(", ")})`;
}

function betweenSql(column: string, filter: Filter): string {
  const { value } = filter;
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`filter on ${filter.column} needs two values`);
  }
  const [low, high] = value;
  return `${column} BETWEEN ${valueSql(low ?? "")} AND ${valueSql(high ?? "")}`;
}

function filterSql(filter: Filter): string {
  const column = quoteIdent(filter.column);
  switch (filter.op) {
    case "eq":
      return `${column} = ${single(filter)}`;
    case "neq":
      return `${column} <> ${single(filter)}`;
    case "lt":
      return `${column} < ${single(filter)}`;
    case "lte":
      return `${column} <= ${single(filter)}`;
    case "gt":
      return `${column} > ${single(filter)}`;
    case "gte":
      return `${column} >= ${single(filter)}`;
    case "contains":
      return containsSql(column, filter);
    case "in":
      return inSql(column, filter);
    case "between":
      return betweenSql(column, filter);
    case "is_null":
      return `${column} IS NULL`;
    case "not_null":
      return `${column} IS NOT NULL`;
    default: {
      const exhaustive: never = filter.op;
      throw new Error(`unhandled filter op ${String(exhaustive)}`);
    }
  }
}

function fieldSql(field: Field): string {
  if (field.column === "*") {
    if (field.aggregate !== "count") {
      throw new Error("* is only allowed with count");
    }
    return `count(*) AS ${quoteIdent(field.alias ?? "count")}`;
  }
  const column = quoteIdent(field.column);
  if (field.aggregate === undefined) {
    return field.alias === undefined ? column : `${column} AS ${quoteIdent(field.alias)}`;
  }
  const alias = field.alias ?? `${field.aggregate}_${field.column}`;
  return `${field.aggregate}(${column}) AS ${quoteIdent(alias)}`;
}

/**
 * The SQL for a visual definition, with `{{params}}` left in place for `bindParams`.
 *
 * Deterministic and readable: one clause per line, so the author sees exactly what the
 * builder made and can switch to SQL mode from it. Whether the grouping is complete is
 * Postgres's to say; its sentence comes back through the runner.
 */
export function compileVisual(definition: VisualDefinition): string {
  const lines = [
    `SELECT ${definition.fields.map(fieldSql).join(", ")}`,
    `FROM ${quoteIdent(definition.table)}`,
  ];
  if (definition.filters.length > 0) {
    lines.push(`WHERE ${definition.filters.map(filterSql).join("\n  AND ")}`);
  }
  if (definition.groupBy.length > 0) {
    lines.push(`GROUP BY ${definition.groupBy.map(quoteIdent).join(", ")}`);
  }
  if (definition.orderBy.length > 0) {
    lines.push(
      `ORDER BY ${definition.orderBy.map((o) => `${quoteIdent(o.by)} ${o.dir.toUpperCase()}`).join(", ")}`,
    );
  }
  lines.push(`LIMIT ${String(definition.limit)}`);
  return lines.join("\n");
}

/** The SQL for either kind of question, parameters still unbound. */
export function compile(definition: QuestionDefinition): string {
  return definition.kind === "sql" ? definition.sql : compileVisual(definition);
}
