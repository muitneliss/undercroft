/**
 * `excel_serial_date()` and `excel_serial_timestamp()`, run for real on PGlite.
 *
 * This is the SQL the macros ship -- `dbtProject.test.ts` pins that each macro is this text with
 * its arguments in place -- so a model typing a workbook column gets exactly these answers. The
 * values come from a table rather than literals, as a model's do: a literal in a CASE branch can
 * be folded before the guard that skips it.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { excelSerialDateSql, excelSerialTimestampSql } from "./services/dbtProject.ts";
import { createMigratedTestDatabase, type TestDatabase } from "./testing.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.exec("CREATE TABLE serials (at integer, value text, date1904 boolean)");
});

afterEach(async () => {
  await db.close();
});

/** Each value's answer under one epoch, in the order given, as ISO text or NULL. */
async function answers(
  sql: (value: string, date1904: string) => string,
  values: readonly string[],
  date1904: boolean | null,
): Promise<(string | null)[]> {
  for (const [at, value] of values.entries()) {
    await db.query("INSERT INTO serials VALUES ($1, $2, $3)", [at, value, date1904]);
  }
  const { rows } = await db.query<{ answer: string | null }>(
    `SELECT ${sql("value", "date1904")}::text AS answer FROM serials ORDER BY at`,
  );
  return rows.map((row) => row.answer);
}

describe("a serial in the 1900 date system", () => {
  it("is the day Excel shows, with Lotus's 1900-02-29 left NULL rather than invented", async () => {
    expect(await answers(excelSerialDateSql, ["1", "59", "60", "61", "46286", "0"], false)).toEqual(
      ["1900-01-01", "1900-02-28", null, "1900-03-01", "2026-09-21", null],
    );
  });
});

describe("a serial in the 1904 date system", () => {
  it("counts from 1904-01-01, so a Mac workbook's dates are not four years out", async () => {
    expect(await answers(excelSerialDateSql, ["0", "44824"], true)).toEqual([
      "1904-01-01",
      "2026-09-21",
    ]);
  });
});

describe("what is not a whole-day serial under a known epoch", () => {
  it("dates nothing: a fraction, a word, an amount, or an epoch the workbook did not state", async () => {
    const known = await answers(excelSerialDateSql, ["46286.5", "Acme", "-3", "1234.10"], false);
    await db.exec("DELETE FROM serials");
    const unknown = await answers(excelSerialDateSql, ["46286"], null);

    expect([...known, ...unknown]).toEqual([null, null, null, null, null]);
  });
});

describe("a serial with a time of day", () => {
  it("is the timestamp Excel shows, to the millisecond, with no time zone attached", async () => {
    expect(
      await answers(excelSerialTimestampSql, ["46286.5", "46286", "46286.000011574", "x"], false),
    ).toEqual(["2026-09-21 12:00:00", "2026-09-21 00:00:00", "2026-09-21 00:00:01", null]);
  });
});
