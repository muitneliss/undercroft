/**
 * The SQL half of `models.check`: what the tokens of a model's SQL -- Jinja already blanked
 * by `jinja.ts`, lexed by `sqlLexer.ts` -- say by themselves. Each rule looks at one token
 * and its neighbours and answers a finding or nothing; `modelCheck.ts` adds what only the
 * Jinja and the tenant's model names can say.
 */

import { SOURCES } from "./dbtSources.ts";
import { type Finding, finding } from "./modelFindings.ts";
import { callArguments, isName, type Token } from "./sqlLexer.ts";

const WRITE_WORDS: ReadonlySet<string> = new Set(
  "insert update delete merge drop alter create truncate grant revoke copy call vacuum".split(" "),
);

const QUERY_STARTS: ReadonlySet<string> = new Set(["select", "with", "values"]);

const ZERO = /^(?:0+(?:\.0*)?|\.0+)$/u;

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

/**
 * A model named bare after `from` or `join`, as a report question writes it. dbt's search
 * path finds it, so it runs -- but without `ref()` dbt does not build that model first, and
 * this one reads whatever the table held last. A CTE of the same name is not the model.
 */
export function bareModelFindings(
  tokens: readonly Token[],
  models: ReadonlySet<string>,
): Finding[] {
  const ctes = new Set(
    tokens
      .filter((_, index) => isName(tokens[index + 1], "as") && tokens[index + 2]?.text === "(")
      .map((token) => token.text),
  );
  return tokens.flatMap((token, index) => {
    const relation = isName(tokens[index - 1], "from") || isName(tokens[index - 1], "join");
    const named = token.kind === "word" || token.kind === "quoted";
    const bare = tokens[index + 1]?.text !== ".";
    return relation && named && bare && models.has(token.text) && !ctes.has(token.text)
      ? [finding("analytics-direct", token.line, token.text)]
      : [];
  });
}

export function namesIn(tokens: readonly Token[]): ReadonlySet<string> {
  return new Set(
    tokens.filter((token) => token.kind === "word" || token.kind === "quoted").map((t) => t.text),
  );
}

export function sqlFindings(tokens: readonly Token[]): Finding[] {
  const first = tokens.find((token) => token.kind !== "jinja");
  if (first === undefined) {
    return [finding("empty", null, null)];
  }
  const query = QUERY_STARTS.has(first.kind === "word" ? first.text : "") || first.text === "(";
  return [...(query ? [] : [finding("not-select", first.line, null)]), ...tokenFindings(tokens)];
}
