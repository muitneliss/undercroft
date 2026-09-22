/**
 * One buffer, several statements: where a scratch query ends and the next one begins.
 *
 * WHY THE BROWSER DOES THIS AND NOT POSTGRES. The worker frames every query as
 * `SELECT * FROM (<sql>) AS _q LIMIT n OFFSET m` and sends it through the extended protocol
 * with an empty parameter list, which makes a second statement a syntax error rather than a
 * second statement -- deliberately, and pinned by a test in `queryRunner.test.ts`. That
 * guarantee is what makes running a stranger's SQL safe, so a console that wants two answers
 * asks twice. Splitting is therefore a question about the author's TEXT, and the text is
 * here.
 *
 * WHY NOT `sql.split(";")`. Because a semicolon is only a terminator where it is not inside
 * something. `WHERE d.text != ';'` is one query; split naively it is two broken halves, and
 * the reader is handed a syntax error about a query they did not write. The four places a
 * semicolon is just a character are a quoted literal, a quoted identifier, a dollar-quoted
 * body and a comment -- so this module reads the buffer rather than searching it.
 *
 * A fragment holding nothing but whitespace and comments is not a statement: a trailing `;`
 * ends the last query rather than opening an empty one, and a buffer of commented-out SQL
 * runs nothing at all.
 */

/** A dollar-quoted opener: `$$` or `$tag$`, anchored, so the tag is matched and not searched for. */
const DOLLAR_OPEN = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u;

/** Whether a character is only spacing. Anything else in a fragment is code. */
const BLANK = /\s/u;

/** What may sit before an `E'…'` prefix. Inside an identifier, an `e` is just a letter. */
const NOT_IDENTIFIER = /[^A-Za-z0-9_$]/u;

/**
 * The end of the comment starting at `at`, or null when none starts there.
 *
 * A block comment NESTS in Postgres -- `/* a /* b *\/ c *\/` is one comment, and a scanner
 * that stopped at the first close would read the rest of the query as prose.
 */
function skipComment(sql: string, at: number): number | null {
  if (sql.startsWith("--", at)) {
    const line = sql.indexOf("\n", at);
    return line === -1 ? sql.length : line + 1;
  }
  if (!sql.startsWith("/*", at)) {
    return null;
  }
  let depth = 0;
  let cursor = at;
  while (cursor < sql.length) {
    if (sql.startsWith("/*", cursor)) {
      depth += 1;
      cursor += 2;
    } else if (sql.startsWith("*/", cursor)) {
      depth -= 1;
      cursor += 2;
      if (depth === 0) {
        return cursor;
      }
    } else {
      cursor += 1;
    }
  }
  // Unterminated: the rest of the buffer is comment. Postgres will say so about the text the
  // author wrote, which is a better sentence than anything this module could invent.
  return sql.length;
}

/**
 * Whether the quote at `at` is an `E'…'` literal, where a backslash escapes the next
 * character. In a plain literal it does not -- `standard_conforming_strings` is on -- and
 * treating one as the other is how `'C:\'` becomes an unterminated string.
 */
function isEscapeString(sql: string, at: number): boolean {
  const prefix = sql[at - 1];
  if (prefix !== "E" && prefix !== "e") {
    return false;
  }
  const before = sql[at - 2];
  return before === undefined || NOT_IDENTIFIER.test(before);
}

/** The end of the `'…'` or `"…"` literal opened at `at`. A doubled quote is the escape. */
function skipDelimited(sql: string, at: number, quote: string): number {
  const escapes = quote === "'" && isEscapeString(sql, at);
  let cursor = at + 1;
  while (cursor < sql.length) {
    if (escapes && sql[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (sql[cursor] === quote) {
      if (sql[cursor + 1] !== quote) {
        return cursor + 1;
      }
      cursor += 2;
      continue;
    }
    cursor += 1;
  }
  return sql.length;
}

/** The end of the `$tag$…$tag$` body opened at `at`, or null when no tag opens there. */
function skipDollarQuoted(sql: string, at: number): number | null {
  const opener = DOLLAR_OPEN.exec(sql.slice(at));
  if (opener === null) {
    return null;
  }
  const [tag] = opener;
  const close = sql.indexOf(tag, at + tag.length);
  return close === -1 ? sql.length : close + tag.length;
}

/**
 * The end of whatever begins at `at`: a comment, a literal, a quoted identifier, a
 * dollar-quoted body -- or the single character that is none of those.
 */
function skipToken(sql: string, at: number): number {
  const comment = skipComment(sql, at);
  if (comment !== null) {
    return comment;
  }
  const char = sql[at];
  if (char === "'" || char === '"') {
    return skipDelimited(sql, at, char);
  }
  if (char === "$") {
    return skipDollarQuoted(sql, at) ?? at + 1;
  }
  return at + 1;
}

/** Whether a fragment holds anything but spacing and comments. */
function holdsCode(fragment: string): boolean {
  let at = 0;
  while (at < fragment.length) {
    const comment = skipComment(fragment, at);
    if (comment !== null) {
      at = comment;
      continue;
    }
    if (!BLANK.test(fragment[at] ?? "")) {
      return true;
    }
    at += 1;
  }
  return false;
}

/**
 * The statements in a buffer, in the order they were written, each without its terminator.
 *
 * An empty buffer, or one holding only comments, yields none -- which is the console's cue
 * to run nothing rather than to ask Postgres about whitespace.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let at = 0;

  function take(fragment: string): void {
    if (holdsCode(fragment)) {
      statements.push(fragment.trim());
    }
  }

  while (at < sql.length) {
    if (sql[at] === ";") {
      take(sql.slice(start, at));
      at += 1;
      start = at;
      continue;
    }
    at = skipToken(sql, at);
  }
  take(sql.slice(start));

  return statements;
}

/**
 * How many statements one press may run.
 *
 * A scratch buffer is where an operator keeps the last thirty things they asked, most of them
 * commented out or simply old, and a press is not a request to run all of them. There is no
 * way to call a run back once it has started, so the cap is the thing standing between a
 * paste and thirty queries nobody wanted -- and what is NOT run is said, never dropped in
 * silence: an operator who does not know a statement was skipped reads its absence as an
 * empty result.
 */
export const MAX_STATEMENTS = 10;

/** One statement of a run, with the identity its pane is drawn under. */
export interface LakeStatement {
  readonly id: string;
  readonly sql: string;
}

/** What one press committed: the statements it runs, and where they came from. */
export interface LakeRun {
  /** Which press this is for this tenant, counting from one. */
  readonly nth: number;
  readonly statements: readonly LakeStatement[];
  /** How many statements the buffer held past the cap, and so did not run. */
  readonly skipped: number;
  /** Whether the text came from a selection rather than from the whole buffer. */
  readonly fromSelection: boolean;
}

/**
 * The run a press commits, from the text it was pressed over.
 *
 * NUMBERED, not identified by content: two identical statements in one buffer are two
 * questions, and a pane keyed by its SQL would collapse them into one. The count also makes
 * a fresh press a fresh set of ids, which is what remounts the panes and runs them again --
 * pressing Run on an unchanged buffer has to re-ask, because the rows may have changed.
 */
export function planRun(
  previous: LakeRun | undefined,
  text: string,
  fromSelection: boolean,
): LakeRun {
  const nth = (previous?.nth ?? 0) + 1;
  const all = splitStatements(text);
  const statements = all.slice(0, MAX_STATEMENTS).map((sql, index) => ({
    id: `${String(nth)}:${String(index)}`,
    sql,
  }));
  return { nth, statements, skipped: all.length - statements.length, fromSelection };
}
