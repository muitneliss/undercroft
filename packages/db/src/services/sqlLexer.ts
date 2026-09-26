/**
 * Postgres SQL as tokens, for `modelCheck.ts` -- enough to tell a keyword from a word that
 * merely contains one, and nothing more.
 *
 * The one thing a model check cannot afford is a false error on a correct model, and nearly
 * every false error a regex would make comes from text that is not code: `'drop table'` in a
 * string, `-- delete me` in a comment, a column quoted as `"update"`. So this reads the four
 * places Postgres hides text -- line and (nested) block comments, `'...'` strings with `''`
 * escapes, `$tag$` bodies and `"..."` identifiers -- and emits everything else as words,
 * numbers and punctuation, each with its line and its parenthesis depth.
 *
 * It is not a parser and does not validate: an unterminated string runs to the end, as
 * Postgres would refuse it anyway at build. `E'...'` backslash escapes are not read, because
 * `standard_conforming_strings` is on and a model has no reason to use them.
 */

export type TokenKind = "word" | "quoted" | "number" | "string" | "punct" | "jinja";

export interface Token {
  readonly kind: TokenKind;
  /** Lower-cased for a `word`, as Postgres folds it; unquoted for a string or identifier. */
  readonly text: string;
  readonly line: number;
  /** Parenthesis depth: of the enclosing parentheses for `(`, `)` and everything between. */
  readonly depth: number;
}

/** What `jinja.ts` leaves where a `{{ ... }}` expression stood: one `jinja` token. */
export const JINJA_MARK = "\u{E000}";

const WORD = /[\p{L}_][\p{L}\p{N}_$]*/uy;
const NUMBER = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/uy;
const DOLLAR_TAG = /\$(?:[A-Za-z_]\w*)?\$/uy;
const WHITESPACE = /\s/u;
const DIGIT = /\d/u;
const NEWLINE = /\n/gu;

export function linesIn(text: string): number {
  return text.match(NEWLINE)?.length ?? 0;
}

/** The index just past a delimited run that doubles its delimiter to escape it. */
function closeDoubled(text: string, from: number, delimiter: string): number {
  let index = from + 1;
  while (index < text.length) {
    if (text.charAt(index) === delimiter) {
      if (text.charAt(index + 1) !== delimiter) {
        return index + 1;
      }
      index += 1;
    }
    index += 1;
  }
  return text.length;
}

/** The index just past a block comment, which Postgres lets nest. */
function closeBlockComment(text: string, from: number): number {
  let depth = 0;
  let index = from;
  while (index < text.length) {
    if (text.startsWith("/*", index)) {
      depth += 1;
      index += 2;
    } else if (text.startsWith("*/", index)) {
      depth -= 1;
      index += 2;
      if (depth === 0) {
        return index;
      }
    } else {
      index += 1;
    }
  }
  return text.length;
}

function sticky(pattern: RegExp, text: string, at: number): string | null {
  pattern.lastIndex = at;
  return pattern.exec(text)?.[0] ?? null;
}

/** The index just past a comment or a whitespace character at `index`, or `null`. */
function skipTrivia(text: string, index: number): number | null {
  if (WHITESPACE.test(text.charAt(index))) {
    return index + 1;
  }
  if (text.startsWith("--", index)) {
    const end = text.indexOf("\n", index);
    return end === -1 ? text.length : end;
  }
  if (text.startsWith("/*", index)) {
    return closeBlockComment(text, index);
  }
  return null;
}

/** Where a string, a quoted name, a dollar body or the Jinja mark at `index` ends, or `null`. */
function enclosedEnd(text: string, index: number): { kind: TokenKind; end: number } | null {
  const char = text.charAt(index);
  if (char === "'") {
    return { kind: "string", end: closeDoubled(text, index, "'") };
  }
  if (char === '"') {
    return { kind: "quoted", end: closeDoubled(text, index, '"') };
  }
  if (char === JINJA_MARK) {
    return { kind: "jinja", end: index + 1 };
  }
  const tag = char === "$" ? sticky(DOLLAR_TAG, text, index) : null;
  if (tag === null) {
    return null;
  }
  const close = text.indexOf(tag, index + tag.length);
  return { kind: "string", end: close === -1 ? text.length : close + tag.length };
}

/** The token starting at `index`: its kind and where it ends. */
function lexeme(text: string, index: number): { kind: TokenKind; end: number } {
  const enclosed = enclosedEnd(text, index);
  if (enclosed !== null) {
    return enclosed;
  }
  const char = text.charAt(index);
  const startsNumber = DIGIT.test(char) || (char === "." && DIGIT.test(text.charAt(index + 1)));
  const number = startsNumber ? sticky(NUMBER, text, index) : null;
  if (number !== null) {
    return { kind: "number", end: index + number.length };
  }
  const word = sticky(WORD, text, index);
  if (word !== null) {
    return { kind: "word", end: index + word.length };
  }
  return { kind: "punct", end: index + (text.startsWith("::", index) ? 2 : 1) };
}

function unquote(raw: string, kind: TokenKind): string {
  if (kind === "word") {
    return raw.toLowerCase();
  }
  if (kind === "quoted") {
    return raw.slice(1, -1).replaceAll('""', '"');
  }
  if (kind === "string" && raw.startsWith("'")) {
    return raw.slice(1, -1).replaceAll("''", "'");
  }
  return raw;
}

/** Comments and whitespace skipped; strings, quoted names and dollar bodies kept whole. */
export function lex(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let depth = 0;
  while (index < text.length) {
    let next = skipTrivia(text, index);
    if (next === null) {
      const { kind, end } = lexeme(text, index);
      const raw = text.slice(index, end);
      if (raw === ")") {
        depth = Math.max(0, depth - 1);
      }
      tokens.push({ kind, text: unquote(raw, kind), line, depth });
      if (raw === "(") {
        depth += 1;
      }
      next = end;
    }
    line += linesIn(text.slice(index, next));
    index = next;
  }
  return tokens;
}

/** A name as Postgres reads it, quoted or not; a keyword never written in quotes is a word. */
export function isName(token: Token | undefined, name: string): boolean {
  return (token?.kind === "word" || token?.kind === "quoted") && token.text === name;
}

/** The tokens of each argument of the call whose `(` is at `open`. */
export function callArguments(tokens: readonly Token[], open: number): Token[][] {
  const inner = (tokens[open]?.depth ?? 0) + 1;
  const args: Token[][] = [[]];
  for (let index = open + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || (token.text === ")" && token.depth < inner)) {
      break;
    }
    if (token.kind === "punct" && token.text === "," && token.depth === inner) {
      args.push([]);
    } else {
      args.at(-1)?.push(token);
    }
  }
  return args;
}
