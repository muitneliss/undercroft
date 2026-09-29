/**
 * What a tenant's macro must be before it is stored: exactly one `{% macro %}` block, named as
 * its row is named, under a name nothing else in the project answers to. ADR 0086.
 *
 * WHY A HARD REFUSAL, when `models.check` only advises. A model that is wrong breaks its own
 * table. A macro file is read by dbt as part of the PROJECT, and a macro defined in the root
 * project silently wins over one of the same name that dbt or the platform ships. A tenant's
 * `generate_schema_name` would move where its tests store failing rows; a `test_not_null`
 * would make every `not_null` test pass; a `postgres__create_table_as` would change how every
 * model is materialised. None of these fails -- each builds green and means something else.
 * So the name is refused, and so is any text that is not one macro whose name is the row's:
 * a second block in the same file would be a second name the row does not show.
 *
 * The database grants remain the security boundary (`privileges.md`): a tenant's dbt login can
 * write nowhere but its own two schemas, whatever a macro says. What this protects is the
 * meaning of the tenant's own build.
 *
 * Reserved:
 * - the platform's macros (`MACROS`) and every name `DBT_CONTEXT` lists;
 * - any name containing `__`, which is how dbt's adapter dispatch names its implementations
 *   (`postgres__*`, `default__*`);
 * - the prefixes dbt gives its own kinds of macro: `generate_` (schema, alias and database
 *   names), `test_` (a generic test is the macro `test_<name>`), `materialization_`;
 * - `should_full_refresh` and `get_where_subquery`, which dbt calls from inside a build.
 *
 * dbt's global macros beyond these (`create_table_as` and the rest) are not listed: overriding
 * one changes only the tenant's own build, inside its own grants, and the list above is the one
 * a model's meaning quietly depends on.
 */

import { MACROS } from "./dbtProject.ts";
import { DBT_CONTEXT, jinjaBlocks, readJinja, statementTag } from "./jinja.ts";

export type MacroRefusal = "not-one-macro" | "name-mismatch" | "reserved-name" | "forbidden-block";

export type MacroDefinition =
  | { readonly ok: true; readonly params: readonly string[] }
  | { readonly ok: false; readonly reason: MacroRefusal; readonly subject: string | null };

const RESERVED_NAMES: ReadonlySet<string> = new Set([
  ...MACROS.map((macro) => macro.name),
  ...DBT_CONTEXT,
  "should_full_refresh",
  "get_where_subquery",
]);
const RESERVED_PREFIXES = ["generate_", "test_", "materialization_"] as const;

/** Blocks dbt reads out of a macro file as something other than a macro. */
const FORBIDDEN_BLOCKS: ReadonlySet<string> = new Set([
  "materialization",
  "test",
  "data_test",
  "snapshot",
  "docs",
]);

const SIGNATURE = /^[-+]?\s*macro\s+(?<name>[A-Za-z_]\w*)\s*\((?<args>[\s\S]*)\)\s*[-+]?\s*$/u;
const PARAM = /^(?<name>[A-Za-z_]\w*)\s*(?:=[\s\S]+)?$/u;
const STRING = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/gu;
const NESTING: Readonly<Record<string, number>> = {
  "(": 1,
  "[": 1,
  "{": 1,
  ")": -1,
  "]": -1,
  "}": -1,
};

export function isReservedMacroName(name: string): boolean {
  return (
    RESERVED_NAMES.has(name) ||
    name.includes("__") ||
    RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

/** The parameter names of `a, b='x', c=[1, 2]`, or `null` if any argument is not one. */
function paramsOf(args: string): string[] | null {
  const plain = args.replace(STRING, (literal) => "_".repeat(literal.length));
  const pieces: string[] = [];
  let depth = 0;
  let from = 0;
  for (let index = 0; index < plain.length; index += 1) {
    const char = plain.charAt(index);
    depth += NESTING[char] ?? 0;
    if (char === "," && depth === 0) {
      pieces.push(plain.slice(from, index));
      from = index + 1;
    }
  }
  pieces.push(plain.slice(from));
  if (pieces.length === 1 && pieces[0]?.trim() === "") {
    return [];
  }
  const params: string[] = [];
  for (const piece of pieces) {
    const name = PARAM.exec(piece.trim())?.groups?.name;
    if (name === undefined) {
      return null;
    }
    params.push(name);
  }
  return params;
}

/** The text with the given ranges cut out. */
function without(text: string, ranges: readonly { start: number; end: number }[]): string {
  const parts: string[] = [];
  let at = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    parts.push(text.slice(at, range.start));
    at = range.end;
  }
  parts.push(text.slice(at));
  return parts.join("");
}

function refused(reason: MacroRefusal, subject: string | null): MacroDefinition {
  return { ok: false, reason, subject };
}

/**
 * Whether `sql` is one macro named `name` that a tenant may define, and its parameters if so.
 * Pure: whether the name is already taken by another row is the caller's question.
 */
export function readMacroDefinition(name: string, sql: string): MacroDefinition {
  if (isReservedMacroName(name)) {
    return refused("reserved-name", name);
  }
  const blocks = jinjaBlocks(sql);
  const statements = blocks
    .filter((block) => block.kind === "statement")
    .map((block) => ({ ...block, tag: statementTag(block.body) }));
  const forbidden = statements.find((s) => s.tag !== null && FORBIDDEN_BLOCKS.has(s.tag));
  if (forbidden !== undefined) {
    return refused("forbidden-block", forbidden.tag);
  }
  const opens = statements.filter((s) => s.tag === "macro");
  const closes = statements.filter((s) => s.tag === "endmacro");
  const [open] = opens;
  const [close] = closes;
  if (opens.length !== 1 || closes.length !== 1 || !open || !close || close.start < open.start) {
    return refused("not-one-macro", null);
  }
  // Outside the one block, only whitespace and comments: anything else is text dbt would read
  // as part of the file and the row would not show.
  const outsideComments = blocks.filter(
    (block) => block.kind === "comment" && (block.end <= open.start || block.start >= close.end),
  );
  const outside = without(sql, [...outsideComments, { start: open.start, end: close.end }]);
  const signature = SIGNATURE.exec(open.body)?.groups;
  const params = paramsOf(signature?.args ?? "");
  if (outside.trim() !== "" || signature?.name === undefined || params === null) {
    return refused("not-one-macro", null);
  }
  if (signature.name !== name) {
    return refused("name-mismatch", signature.name);
  }
  return { ok: true, params };
}

/**
 * Which of `texts` -- the tenant's models, and its other macros -- call the macro `name`. A
 * macro that one of them calls cannot be deleted: every build of the tenant would fail on the
 * call, and the person deleting it would not be the one who finds out.
 */
export function callersOf(
  name: string,
  texts: readonly { readonly name: string; readonly sql: string }[],
): string[] {
  return texts
    .filter((text) => readJinja(text.sql).calls.some((call) => call.name === name))
    .map((text) => text.name);
}
