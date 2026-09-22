/**
 * What the splitter promises: a top-level `;` ends a statement, and nothing else does.
 *
 * The half that matters is the second one. A console that split on every semicolon would cut
 * `WHERE d.text != ';'` in two and answer a question the author never asked -- with a syntax
 * error about text they did not write. So each place a semicolon is just a character gets its
 * own case, and each is a query that must come back whole.
 */

import { describe, expect, test as it } from "bun:test";

import { splitStatements } from "@/lib/statements.ts";

describe("splitStatements", () => {
  it("two statements separated by a semicolon are two queries", () => {
    expect(
      splitStatements(
        "SELECT d.text\nFROM document_text AS d\nLIMIT 1;\n\nSELECT r.payload\nFROM records AS r\nLIMIT 1;",
      ),
    ).toEqual([
      "SELECT d.text\nFROM document_text AS d\nLIMIT 1",
      "SELECT r.payload\nFROM records AS r\nLIMIT 1",
    ]);
  });

  it("a blank line inside one query does not end it", () => {
    expect(splitStatements("SELECT 1\n\nFROM records")).toEqual(["SELECT 1\n\nFROM records"]);
  });

  it("a semicolon inside a string literal is a character, not a terminator", () => {
    expect(splitStatements("SELECT * FROM documents WHERE name != ';'")).toEqual([
      "SELECT * FROM documents WHERE name != ';'",
    ]);
  });

  it("a doubled quote inside a literal does not close it", () => {
    expect(splitStatements("SELECT 'it''s here; still' AS a")).toEqual([
      "SELECT 'it''s here; still' AS a",
    ]);
  });

  it("a backslash escapes the quote in an E-string, and not in a plain one", () => {
    expect(splitStatements("SELECT E'a\\'; b' AS a")).toEqual(["SELECT E'a\\'; b' AS a"]);
    expect(splitStatements("SELECT 'a\\' AS a; SELECT 2")).toEqual([
      "SELECT 'a\\' AS a",
      "SELECT 2",
    ]);
  });

  it("a semicolon inside a quoted identifier is a character", () => {
    expect(splitStatements('SELECT "odd;name" FROM documents')).toEqual([
      'SELECT "odd;name" FROM documents',
    ]);
  });

  it("a semicolon inside a dollar-quoted body is a character", () => {
    expect(splitStatements("SELECT $tag$ a; b $tag$ AS a")).toEqual([
      "SELECT $tag$ a; b $tag$ AS a",
    ]);
  });

  it("a semicolon inside a line comment is a character", () => {
    expect(splitStatements("SELECT 1 -- and then; nothing\nFROM records")).toEqual([
      "SELECT 1 -- and then; nothing\nFROM records",
    ]);
  });

  it("a semicolon inside a nested block comment is a character", () => {
    expect(splitStatements("SELECT 1 /* a /* b; c */ d */ FROM records")).toEqual([
      "SELECT 1 /* a /* b; c */ d */ FROM records",
    ]);
  });

  it("a trailing semicolon ends the last statement rather than opening an empty one", () => {
    expect(splitStatements("SELECT 1;\n")).toEqual(["SELECT 1"]);
    expect(splitStatements("SELECT 1;;")).toEqual(["SELECT 1"]);
  });

  it("a buffer of nothing but spacing and comments holds no statement", () => {
    expect(splitStatements("")).toEqual([]);
    expect(splitStatements("  \n\t ")).toEqual([]);
    expect(splitStatements("-- nothing to run\n/* nor here */")).toEqual([]);
  });
});
