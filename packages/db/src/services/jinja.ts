/**
 * The Jinja in a model, read out and blanked, for `modelCheck.ts`.
 *
 * A model is SQL with Jinja in it, and the two must be read apart: `{{ source(...) }}` is not
 * SQL, and `delete` inside `{# ... #}` is not a write. So every block is taken out before the
 * SQL is lexed, and what it said is reported as facts -- the calls it makes, the `ref()` and
 * `source()` it names, the names it binds -- with no judgement about any of them. Judging is
 * `modelCheck.ts`'s job; this only reads.
 *
 * The blanked text keeps every newline, so a line number the lexer reports afterwards is the
 * author's own. A `{{ ... }}` expression becomes one `JINJA_MARK`, because it stands where a
 * value or a relation would; a `{% ... %}` statement and a `{# ... #}` comment become a space.
 */

import { JINJA_MARK, linesIn } from "./sqlLexer.ts";

export interface JinjaCall {
  /** The first segment of the called name: `dbt_utils` for `dbt_utils.star(...)`. */
  readonly name: string;
  readonly line: number;
}

export interface JinjaReference {
  readonly fn: "ref" | "source";
  /** The literal string arguments, or `null` when any argument is not a plain literal. */
  readonly args: readonly string[] | null;
  readonly line: number;
}

export interface JinjaReading {
  /** The SQL with every block blanked, newlines kept. */
  readonly text: string;
  readonly calls: readonly JinjaCall[];
  /**
   * Each `{{ name }}` expression that is a name and nothing else -- `{{ this }}`,
   * `{{ target.schema }}`, or a report question's `{{ date_from }}` left behind -- by its
   * first segment.
   */
  readonly names: readonly JinjaCall[];
  readonly references: readonly JinjaReference[];
  /** Names a `{% set %}` or `{% for %}` binds, which a later block may call. */
  readonly bound: ReadonlySet<string>;
}

/**
 * What a model may call in Jinja without it being a macro of the project: dbt's context
 * and Jinja's own globals. `modelCheck.ts` warns on a name outside this and `MACROS` rather
 * than refusing it -- dbt has more than a model ever needs, and a false error would block a
 * correct model.
 */
export const DBT_CONTEXT: ReadonlySet<string> = new Set([
  "source",
  "ref",
  "config",
  "var",
  "env_var",
  "is_incremental",
  "adapter",
  "log",
  "return",
  "run_query",
  "statement",
  "exceptions",
  "modules",
  "target",
  "this",
  "zip",
  "range",
  "dict",
  "list",
  "tojson",
  "fromjson",
  "toyaml",
  "fromyaml",
  "local_md5",
  "set",
  "set_strict",
  "print",
  "debug",
  "as_bool",
  "as_native",
  "as_number",
  "as_text",
  "namespace",
  "cycler",
  "joiner",
  "lipsum",
  "caller",
  "super",
  "loop",
]);

const BLOCK = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/gu;
/** A call's name -- not a filter's (`| replace(...)`), not a method's (`x.startswith(`). */
const CALL = /(?<![|.]\s*)(?<!\w)(?<name>[A-Za-z_]\w*)(?:\.[A-Za-z_]\w*)*\s*\(/gu;
const STRING = /'[^']*'|"[^"]*"/gu;
const BINDING = /\b(?:set|for)\s+(?<names>[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)/gu;
const REFERENCE = /(?<![\w.])(?<fn>ref|source)\s*\(/gu;
const BARE_NAME = /^\s*(?<name>[A-Za-z_]\w*)(?:\.[A-Za-z_]\w*)*\s*$/u;
const LITERAL = /^\s*(?<q>['"])(?<value>[^'"]*)\k<q>\s*$/u;

/** How a character moves the parenthesis depth. */
const DEPTH_STEP: Readonly<Record<string, number>> = { "(": 1, ")": -1 };

/** The text between the `(` at `open` and its matching `)`, strings respected, or `null`. */
function argumentsFrom(body: string, open: number): string | null {
  // Strings blanked to the same length, so a parenthesis inside one is not counted.
  const plain = body.replace(STRING, (literal) => "_".repeat(literal.length));
  let depth = 0;
  for (let index = open; index < plain.length; index += 1) {
    depth += DEPTH_STEP[plain.charAt(index)] ?? 0;
    if (depth === 0) {
      return body.slice(open + 1, index);
    }
  }
  return null;
}

/** Each comma-separated argument as a plain string literal, or `null` if any is not one. */
function literals(args: string | null): string[] | null {
  if (args === null) {
    return null;
  }
  const values: string[] = [];
  for (const arg of args.split(",")) {
    const value = LITERAL.exec(arg)?.groups?.value;
    if (value === undefined) {
      return null;
    }
    values.push(value);
  }
  return values;
}

function referencesIn(body: string, line: number): JinjaReference[] {
  return [...body.matchAll(REFERENCE)].map((match) => ({
    fn: match.groups?.fn === "source" ? "source" : "ref",
    args: literals(argumentsFrom(body, match.index + match[0].length - 1)),
    line,
  }));
}

function callsIn(body: string, line: number): JinjaCall[] {
  return [...body.replace(STRING, '""').matchAll(CALL)].map((match) => ({
    name: match.groups?.name ?? "",
    line,
  }));
}

export function readJinja(sql: string): JinjaReading {
  const calls: JinjaCall[] = [];
  const names: JinjaCall[] = [];
  const references: JinjaReference[] = [];
  const bound = new Set<string>();
  const text = sql.replace(BLOCK, (block: string, offset: number) => {
    const newlines = "\n".repeat(linesIn(block));
    if (block.startsWith("{#")) {
      return ` ${newlines}`;
    }
    const body = block.slice(2, -2);
    const line = linesIn(sql.slice(0, offset)) + 1;
    calls.push(...callsIn(body, line));
    references.push(...referencesIn(body, line));
    const bare = block.startsWith("{{") ? BARE_NAME.exec(body)?.groups?.name : undefined;
    if (bare !== undefined) {
      names.push({ name: bare, line });
    }
    for (const match of body.matchAll(BINDING)) {
      for (const name of (match.groups?.names ?? "").split(",")) {
        bound.add(name.trim());
      }
    }
    return block.startsWith("{{") ? `${JINJA_MARK}${newlines}` : ` ${newlines}`;
  });
  return { text, calls, names, references, bound };
}
