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
 * facts and decide nothing. `sqlChecks.ts` decides what the SQL's tokens say, this module
 * what the Jinja says, both in the words of `modelFindings.ts`. `source()` and `ref()` are
 * checked against what exists: the sources `SOURCES_YML` declares (`dbtSources.ts`, read
 * from that text so the two cannot drift), and the tenant's own models, which the caller
 * passes in.
 *
 * `raw.document_text` is granted to dbt but is not a declared source, so reading it directly
 * is the only way there is; `raw-direct` fires only for a table a source declares.
 */

import { MACROS } from "./dbtProject.ts";
import { SOURCES } from "./dbtSources.ts";
import { DBT_CONTEXT, type JinjaReading, readJinja } from "./jinja.ts";
import { type Finding, finding, type ModelCheck, UNVERIFIED } from "./modelFindings.ts";
import { bareModelFindings, namesIn, sqlFindings } from "./sqlChecks.ts";
import { lex, type Token } from "./sqlLexer.ts";

export type {
  Finding,
  FindingCode,
  ModelCheck,
  Severity,
  UnverifiedCode,
} from "./modelFindings.ts";

export interface ModelCheckInput {
  readonly name: string;
  readonly sql: string;
  readonly tests: { readonly columns: Readonly<Record<string, readonly string[]>> };
  /** The tenant's model names, which a `ref()` must name one of. */
  readonly existingModels: readonly string[];
}

// ---------------------------------------------------------------------------------------
// Jinja

const MACRO_NAMES: ReadonlySet<string> = new Set(MACROS.map((macro) => macro.name));

function known(jinja: JinjaReading, name: string): boolean {
  return DBT_CONTEXT.has(name) || MACRO_NAMES.has(name) || jinja.bound.has(name);
}

/**
 * A call to something the project does not ship is a warning; a bare `{{ name }}` nothing
 * binds is an error. A report question writes its parameters exactly so, and dbt renders an
 * unknown name as an empty string -- the filter would vanish from a build that succeeds.
 */
function nameFindings(jinja: JinjaReading): Finding[] {
  return [
    ...jinja.calls
      .filter(({ name }) => !known(jinja, name))
      .map(({ name, line }) => finding("unknown-macro", line, name)),
    ...jinja.names
      .filter(({ name }) => !known(jinja, name))
      .map(({ name, line }) => finding("report-parameter", line, name)),
  ];
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
      const declaredTable = args.length === 2 && declared?.tables.includes(table) === true;
      return declaredTable ? [] : [finding("unknown-source", line, `${name}.${table}`)];
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
  const sql = [...sqlFindings(tokens), ...bareModelFindings(tokens, new Set(input.existingModels))];
  const whole = sql.some((found) => found.code === "empty")
    ? []
    : wholeModelFindings(tokens, sql, jinja, input);
  return {
    findings: distinct([
      ...nameFindings(jinja),
      ...referenceFindings(jinja, input),
      ...sql,
      ...whole,
    ]),
    unverified: UNVERIFIED,
  };
}
