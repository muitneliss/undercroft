/**
 * What can be said about a model's SQL before anything runs it.
 *
 * `models.check` answers with this so an author -- a person, or an agent the model-builder
 * skill drives -- hears about a mistake while it is still text. It is deliberately modest,
 * and says so on every answer.
 *
 * - **An error is lexically certain.** A `;` outside a string, `delete` outside a comment, a
 *   `ref()` to a model the tenant does not have: each is in the text or it is not, and each
 *   fails the build or does something a model must never do. A model is one SELECT that dbt
 *   wraps in `CREATE TABLE ... AS`, so a semicolon ends that statement early and a write
 *   keyword is a write.
 * - **A warning is a suspicion the author must look at**: records read with no mention of
 *   `deleted_at` return tombstoned rows as live; `coalesce(x, 0)` turns a missing value into
 *   a real-looking zero; a top-level `limit` saves a sample as if it were the table.
 * - **`unverified` is always there** (rule 2: no evidence is not a pass). Whether the SQL
 *   compiles, whether a payload key exists, what a column's type is, whether the tests pass
 *   and what a called function does are not visible in text. Build decides them, and the
 *   tenant's dbt login's grants decide the last one -- which is also why this is not the
 *   security boundary and does not try to be.
 *
 * `jinja.ts` reads the Jinja out first and `sqlLexer.ts` tokenises what is left; both report
 * facts, and every decision is here. `source()` and `ref()` are checked against what exists:
 * the sources `SOURCES_YML` declares, read from that text so the two cannot drift, and the
 * tenant's own models, which the caller passes in.
 *
 * `raw.document_text` is granted to dbt but is not a declared source, so reading it directly
 * is the only way there is; `raw-direct` fires only for a table a source declares.
 */

import { MACROS } from "./dbtProject.ts";
import { SOURCES } from "./dbtSources.ts";
import { DBT_CONTEXT, type JinjaReading, readJinja } from "./jinja.ts";
import { callArguments, isName, lex, type Token } from "./sqlLexer.ts";

export type FindingCode =
  | "empty"
  | "semicolon"
  | "not-select"
  | "write-statement"
  | "select-into"
  | "raw-direct"
  | "analytics-direct"
  | "unknown-source"
  | "unknown-ref"
  | "self-ref"
  | "no-tombstone-filter"
  | "zero-default"
  | "top-level-limit"
  | "unknown-macro"
  | "dynamic-reference"
  | "test-column-unmentioned";

export type Severity = "error" | "warning";

export interface Finding {
  readonly code: FindingCode;
  readonly severity: Severity;
  /** 1-based, the author's own line; `null` for a finding about the model as a whole. */
  readonly line: number | null;
  /** What the finding is about -- a keyword, a model, a column -- when it names one. */
  readonly subject: string | null;
}

/** What text alone cannot show, in the order an author would run into it. */
export type UnverifiedCode =
  | "compiles"
  | "payload-keys"
  | "column-types"
  | "tests-pass"
  | "function-effects";

export interface ModelCheck {
  readonly findings: readonly Finding[];
  readonly unverified: readonly UnverifiedCode[];
}

export interface ModelCheckInput {
  readonly name: string;
  readonly sql: string;
  readonly tests: { readonly columns: Readonly<Record<string, readonly string[]>> };
  /** The tenant's model names, which a `ref()` must name one of. */
  readonly existingModels: readonly string[];
}

const SEVERITY: Readonly<Record<FindingCode, Severity>> = {
  empty: "error",
  semicolon: "error",
  "not-select": "error",
  "write-statement": "error",
  "select-into": "error",
  "raw-direct": "error",
  "analytics-direct": "error",
  "unknown-source": "error",
  "unknown-ref": "error",
  "self-ref": "error",
  "no-tombstone-filter": "warning",
  "zero-default": "warning",
  "top-level-limit": "warning",
  "unknown-macro": "warning",
  "dynamic-reference": "warning",
  "test-column-unmentioned": "warning",
};

const UNVERIFIED: readonly UnverifiedCode[] = [
  "compiles",
  "payload-keys",
  "column-types",
  "tests-pass",
  "function-effects",
];

/** Words that make a statement a write, wherever they stand -- a CTE included. */
const WRITE_WORDS: ReadonlySet<string> = new Set([
  "insert",
  "update",
  "delete",
  "merge",
  "drop",
  "alter",
  "create",
  "truncate",
  "grant",
  "revoke",
  "copy",
  "call",
  "vacuum",
]);

const QUERY_STARTS: ReadonlySet<string> = new Set(["select", "with", "values"]);

const ZERO = /^(?:0+(?:\.0*)?|\.0+)$/u;

function finding(code: FindingCode, line: number | null, subject: string | null): Finding {
  return { code, severity: SEVERITY[code], line, subject };
}

// ---------------------------------------------------------------------------------------
// Jinja

function macroFindings(jinja: JinjaReading): Finding[] {
  const macros = new Set(MACROS.map((macro) => macro.name));
  return jinja.calls
    .filter(({ name }) => !(DBT_CONTEXT.has(name) || macros.has(name) || jinja.bound.has(name)))
    .map(({ name, line }) => finding("unknown-macro", line, name));
}

function referenceFindings(jinja: JinjaReading, input: ModelCheckInput): Finding[] {
  const existing = new Set(input.existingModels);
  return jinja.references.flatMap(({ fn, args, line }): Finding[] => {
    if (args === null) {
      return [finding("dynamic-reference", line, fn)];
    }
    if (fn === "source") {
      const [name = "", table = ""] = args;
      const declared = SOURCES.find((source) => source.name === name);
      const known = args.length === 2 && declared?.tables.includes(table) === true;
      return known ? [] : [finding("unknown-source", line, `${name}.${table}`)];
    }
    // `ref('model')` or `ref('package', 'model')`: the model is the last argument.
    const model = args.at(-1) ?? "";
    if (model === input.name) {
      return [finding("self-ref", line, model)];
    }
    return existing.has(model) ? [] : [finding("unknown-ref", line, model)];
  });
}

function readsRecordsThroughSource(jinja: JinjaReading): boolean {
  return jinja.references.some(
    ({ fn, args }) =>
      fn === "source" &&
      SOURCES.some((source) => source.name === args?.[0] && source.tables.includes("records")) &&
      args?.[1] === "records",
  );
}

// ---------------------------------------------------------------------------------------
// SQL, one token at a time

/** A check of the token at `index`, answering a finding or nothing. */
type TokenRule = (tokens: readonly Token[], index: number) => Finding | null;

function semicolon(tokens: readonly Token[], index: number): Finding | null {
  const token = tokens[index];
  return token?.kind === "punct" && token.text === ";"
    ? finding("semicolon", token.line, null)
    : null;
}

function writeWord(tokens: readonly Token[], index: number): Finding | null {
  const token = tokens[index];
  return token?.kind === "word" && WRITE_WORDS.has(token.text)
    ? finding("write-statement", token.line, token.text)
    : null;
}

function selectInto(tokens: readonly Token[], index: number): Finding | null {
  const token = tokens[index];
  const previous = tokens[index - 1];
  const intoATable = !(isName(previous, "insert") || isName(previous, "merge"));
  return token !== undefined && isName(token, "into") && intoATable
    ? finding("select-into", token.line, null)
    : null;
}

function topLevelLimit(tokens: readonly Token[], index: number): Finding | null {
  const token = tokens[index];
  return token !== undefined && isName(token, "limit") && token.depth === 0
    ? finding("top-level-limit", token.line, null)
    : null;
}

/** `0`, `0.00`, `'0'`, optionally cast: the literal a missing value must not become. */
function isZero(argument: readonly Token[]): boolean {
  const [first, second] = argument;
  const literal = first?.kind === "number" || first?.kind === "string";
  return literal && ZERO.test(first.text.trim()) && (second === undefined || second.text === "::");
}

function zeroDefault(tokens: readonly Token[], index: number): Finding | null {
  const token = tokens[index];
  if (token === undefined || !isName(token, "coalesce") || tokens[index + 1]?.text !== "(") {
    return null;
  }
  return isZero(callArguments(tokens, index + 1).at(-1) ?? [])
    ? finding("zero-default", token.line, null)
    : null;
}

/** `schema.table` where the schema is one a model must reach through dbt instead. */
function qualified(tokens: readonly Token[], index: number): Finding | null {
  const [schema, dot, table] = [tokens[index], tokens[index + 1], tokens[index + 2]];
  const named = schema?.kind === "word" || schema?.kind === "quoted";
  if (schema === undefined || !named || dot?.kind !== "punct" || dot.text !== "." || !table) {
    return null;
  }
  const declared = SOURCES.some(
    (source) => source.schema === schema.text && source.tables.some((t) => isName(table, t)),
  );
  if (declared) {
    return finding("raw-direct", schema.line, table.text);
  }
  return schema.text.startsWith("analytics_")
    ? finding("analytics-direct", schema.line, `${schema.text}.${table.text}`)
    : null;
}

const TOKEN_RULES: readonly TokenRule[] = [
  semicolon,
  writeWord,
  selectInto,
  topLevelLimit,
  zeroDefault,
  qualified,
];

function tokenFindings(tokens: readonly Token[]): Finding[] {
  return tokens.flatMap((_, index) =>
    TOKEN_RULES.map((rule) => rule(tokens, index)).filter((found) => found !== null),
  );
}

function namesIn(tokens: readonly Token[]): ReadonlySet<string> {
  return new Set(
    tokens.filter((token) => token.kind === "word" || token.kind === "quoted").map((t) => t.text),
  );
}

/** Findings about the model as a whole, given the per-token ones already found. */
function wholeModelFindings(
  tokens: readonly Token[],
  sql: readonly Finding[],
  jinja: JinjaReading,
  input: ModelCheckInput,
): Finding[] {
  const names = namesIn(tokens);
  const readsRawRecords = sql.some((f) => f.code === "raw-direct" && f.subject === "records");
  const readsRecords = readsRawRecords || readsRecordsThroughSource(jinja);
  const tombstones =
    readsRecords && !names.has("deleted_at") ? [finding("no-tombstone-filter", null, null)] : [];
  const untested = Object.keys(input.tests.columns)
    .filter((column) => !names.has(column))
    .map((column) => finding("test-column-unmentioned", null, column));
  return [...tombstones, ...untested];
}

function sqlFindings(tokens: readonly Token[]): Finding[] {
  const first = tokens.find((token) => token.kind !== "jinja");
  if (first === undefined) {
    return [finding("empty", null, null)];
  }
  const query = QUERY_STARTS.has(first.kind === "word" ? first.text : "") || first.text === "(";
  return [...(query ? [] : [finding("not-select", first.line, null)]), ...tokenFindings(tokens)];
}

/** Deduplicated by what a reader would see: the same code, line and subject once. */
function distinct(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((found) => {
    const key = `${found.code}|${String(found.line)}|${found.subject ?? ""}`;
    const fresh = !seen.has(key);
    seen.add(key);
    return fresh;
  });
}

/**
 * Everything text alone can say about a model, and what it cannot. Pure: the tenant's model
 * names are the caller's to read.
 */
export function checkModel(input: ModelCheckInput): ModelCheck {
  const jinja = readJinja(input.sql);
  const tokens = lex(jinja.text);
  const sql = sqlFindings(tokens);
  const whole = sql.some((found) => found.code === "empty")
    ? []
    : wholeModelFindings(tokens, sql, jinja, input);
  return {
    findings: distinct([
      ...macroFindings(jinja),
      ...referenceFindings(jinja, input),
      ...sql,
      ...whole,
    ]),
    unverified: UNVERIFIED,
  };
}
