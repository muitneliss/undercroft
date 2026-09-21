/**
 * The two folds cannot drift apart.
 *
 * `raw.fold` in `packages/db/sql/190_raw_search.sql` is what MATCHED a search hit;
 * `fold()` in `apps/ui/src/lib/fold.ts` is what HIGHLIGHTS it. Each has its own behavioural
 * tests, and each passes them while disagreeing with the other -- a letter one side folds and
 * the other does not is a term that matched in Postgres and is left unmarked on screen, or a
 * word marked on screen that Postgres never matched. Nothing else would report it: both files
 * keep working, and the excerpt still renders.
 *
 * So this reads the REAL files and compares the character SETS they fold. It is deliberately
 * not a re-implementation of either: what it asserts is that neither knows a letter the other
 * does not. That the mapping itself is right -- which letter becomes which -- is what the two
 * behavioural suites assert, against real Postgres and in the browser's own runtime.
 */

import { describe, expect, test as it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const SQL = join(REPO, "packages/db/sql/190_raw_search.sql");
const TS = join(REPO, "apps/ui/src/lib/fold.ts");

const SINGLE_QUOTED = /'(?<literal>[^']*)'/gu;
const DOUBLE_QUOTED = /"(?<literal>[^"]*)"/gu;
/** Everything the fold tables are made of: letters outside plain ASCII. */
const NON_ASCII = /[^\p{ASCII}]/u;
/**
 * A comment to end of line, in either language.
 *
 * Stripped BEFORE the literals are read, and not an optimisation: an apostrophe in an English
 * sentence -- "the database's collation", "the string's length" -- breaks the quote pairing
 * below and silently shifts every literal after it, so the SQL side came back holding the gaps
 * between the strings instead of the strings. It is what this file caught on its first run.
 */
const COMMENT = /(?:--|\/\/)[^\n]*/gu;

/** The body of `raw.fold`, from its CREATE to the `$$` that ends it. */
function sqlFoldBody(): string {
  const sql = readFileSync(SQL, "utf8");
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION raw.fold(");
  expect(start).toBeGreaterThan(-1);
  const open = sql.indexOf("$$", start);
  const close = sql.indexOf("$$", open + 2);
  expect(close).toBeGreaterThan(open);
  return sql.slice(open, close);
}

/** The `FOLD_PAIRS` table, from its declaration to the `];` that closes it. */
function tsFoldTable(): string {
  const ts = readFileSync(TS, "utf8");
  const start = ts.indexOf("const FOLD_PAIRS");
  expect(start).toBeGreaterThan(-1);
  const end = ts.indexOf("\n];", start);
  expect(end).toBeGreaterThan(start);
  return ts.slice(start, end);
}

/** Every non-ASCII character named in the string literals of `source`. */
function foldedCharacters(source: string, quoted: RegExp): Set<string> {
  const characters = new Set<string>();
  for (const match of source.replace(COMMENT, "").matchAll(quoted)) {
    for (const character of match.groups?.literal ?? "") {
      if (NON_ASCII.test(character)) {
        characters.add(character);
      }
    }
  }
  return characters;
}

/** Sorted, so a failure prints the missing letters rather than two unordered blobs. */
function sorted(characters: Set<string>): string[] {
  return [...characters].sort();
}

describe("raw.fold and the browser's fold know the same letters", () => {
  it("neither folds a character the other leaves alone", () => {
    const inSql = foldedCharacters(sqlFoldBody(), SINGLE_QUOTED);
    const inTs = foldedCharacters(tsFoldTable(), DOUBLE_QUOTED);
    expect(sorted(inTs)).toEqual(sorted(inSql));
  });

  it("would notice: drop one letter from either table and the sets differ", () => {
    // The firing side. A comparison that always passed -- because the extractor came back
    // empty, say -- would look exactly like agreement, and that is not a hypothetical: the
    // extractor DID come back empty on this file's first run, fooled by an apostrophe in a
    // comment. Doctoring a copy is what tells the two apart.
    const sql = sqlFoldBody();
    const ts = tsFoldTable();
    expect(sorted(foldedCharacters(sql.replace("ữ", ""), SINGLE_QUOTED))).not.toEqual(
      sorted(foldedCharacters(sql, SINGLE_QUOTED)),
    );
    expect(sorted(foldedCharacters(ts.replace("ữ", ""), DOUBLE_QUOTED))).not.toEqual(
      sorted(foldedCharacters(ts, DOUBLE_QUOTED)),
    );
  });

  it("covers every Vietnamese vowel with a tone mark, in both cases", () => {
    // The quiet side of the guard above: two tables that agreed with each other and were both
    // missing `ữ` would pass it, and `hop dong` would find nothing in half the language.
    const inSql = foldedCharacters(sqlFoldBody(), SINGLE_QUOTED);
    const vietnamese = "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ";
    for (const lower of vietnamese) {
      expect(inSql.has(lower)).toBe(true);
      expect(inSql.has(lower.toUpperCase())).toBe(true);
    }
  });
});
