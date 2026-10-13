/**
 * What a tenant's reference table -- a dbt seed -- is allowed to be, and the CSV file dbt loads
 * it from. ADR 0128.
 *
 * A seed is a small table a person keeps by hand: accounts mapped to groups, people and the
 * roles a reviewer decided, a dictionary of patterns. A model reads it with `{{ ref('name') }}`,
 * like another model, so its name follows the model's identifier rule, and so does every
 * column's name. Every column is TYPED by its author from `SEED_COLUMN_TYPES`; nothing is
 * inferred from the cells. A cell is a string or `null`, never a number -- an amount is the
 * string it was written as, all the way into `numeric(18,4)` (`.claude/rules/money.md`).
 *
 * THE RULES AND THE FILE ARE ONE MODULE, because they are one promise: every cell
 * `seedRefusal` admits is a value of its column's declared type, and dbt reads it back out of
 * `seedCsv`'s file as exactly that value. The refusals are what that promise costs -- each is a
 * way dbt 1.9's seed loader would otherwise change a value without a word -- so the reader that
 * decides them and the writer that relies on them stay together. Here, below every layer and
 * browser-safe, so the control plane refuses with them, the worker renders with them, and an
 * editor can check a table before it is sent.
 *
 * HOW DBT READS THE FILE. Every column carries a `column_types` entry (`dbtProject.ts`), so the
 * loader reads every cell as text (agate's `Text`, forced for each typed column) and Postgres
 * casts it into the column's type on insert. Three things happen on the way that would change a
 * value, and each is refused rather than worked around:
 *
 * - A text cell that is empty, only whitespace, or `null` in any case once stripped is read as
 *   NULL (agate's null values for a text column are `""` and `"null"`). A CSV cannot say "the
 *   empty string" to it, so an empty or `null`-looking text cell is refused, and the author
 *   sends `null` for a missing value -- which renders as an empty field and loads as NULL.
 *   "Whitespace" here is Python's, which `str.strip` uses: JavaScript's `\s` plus the four
 *   information separators and NEL, which Python counts, and less the byte-order mark, which it
 *   does not.
 * - The loader opens the file in Python's universal-newline mode, so a carriage return inside a
 *   quoted field reaches the table as a line feed. A cell holding `\r` is refused.
 * - Postgres text cannot hold a NUL character (and Python's CSV reader before 3.11 stops at
 *   one); a lone UTF-16 surrogate cannot be written as UTF-8 at all. Both are refused, and so is a cell longer than
 *   the reader's field limit (`MAX_SEED_CELL_CHARS`), which dbt does not raise.
 *
 * TYPED CELLS are checked against the text forms Postgres reads into each type, strictly: what
 * is refused is anything Postgres would read differently from how it looks, or would round.
 * `integer` and `bigint` are plain integers in range with no leading zero -- a leading zero is a
 * code that wants a text column, and Postgres would drop it. `numeric(18,4)` is a plain decimal
 * of at most 14 integer and 4 fraction digits, checked as text and never through a float
 * (`.claude/rules/money.md`): a fifth decimal would be rounded away. `boolean` is `true` or
 * `false`. `date` is a real calendar day as `YYYY-MM-DD`. `timestamptz` is
 * `YYYY-MM-DD[T ]HH:MM:SS[.ffffff]` with an explicit offset or `Z`, because one without an
 * offset would be read in the session's time zone, which is a guess.
 *
 * Pure: a table in, a refusal or `null` out, and the file's text. The caller words the refusal.
 */

import { z } from "zod";

import { MAX_IDENTIFIER_CHARS, MODEL_NAME } from "./models.ts";

export const SeedName = z.string().regex(MODEL_NAME).max(MAX_IDENTIFIER_CHARS);
export type SeedName = z.infer<typeof SeedName>;

/**
 * The column types a seed may declare, spelled as Postgres and dbt's `column_types` take them.
 * A short list on purpose: each is one whose text form this platform can check exactly before
 * dbt sees it, and `numeric(18,4)` is the platform's one money type.
 */
export const SEED_COLUMN_TYPES = [
  "text",
  "integer",
  "bigint",
  "numeric(18,4)",
  "boolean",
  "date",
  "timestamptz",
] as const;
export const SeedColumnType = z.enum(SEED_COLUMN_TYPES);
export type SeedColumnType = z.infer<typeof SeedColumnType>;

export const SeedColumn = z.object({
  name: z.string().regex(MODEL_NAME).max(MAX_IDENTIFIER_CHARS),
  type: SeedColumnType,
});
export type SeedColumn = z.infer<typeof SeedColumn>;

/** One cell: the text of a value, or `null` for none. Never a number, never a boolean. */
export const SeedCell = z.string().nullable();
export type SeedCell = z.infer<typeof SeedCell>;

/** The most rows one seed holds. A seed is a reference table, not a data file. */
export const MAX_SEED_ROWS = 10_000;
/** The most columns one seed declares. */
export const MAX_SEED_COLUMNS = 100;
/** The most bytes a seed's columns and rows may take, as the JSON they are stored as. */
export const MAX_SEED_BYTES = 1024 * 1024;
/**
 * The longest cell, in UTF-16 units: Python's `csv.field_size_limit()` default, which neither
 * dbt nor agate raises, so a longer field fails the load. A unit count is never below the
 * character count Python checks, so this refuses nothing the loader would read.
 */
export const MAX_SEED_CELL_CHARS = 131_072;

/** Why a seed is refused: the table's shape, or one cell against its column's type. */
export type SeedProblem =
  | "too-many-columns"
  | "too-many-rows"
  | "too-large"
  | "duplicate-column"
  | "unknown-type"
  | "row-width"
  | "reads-as-null"
  | "carriage-return"
  | "unstorable-character"
  | "cell-too-long"
  | "not-integer"
  | "out-of-range"
  | "not-decimal"
  | "too-many-digits"
  | "too-many-decimals"
  | "not-boolean"
  | "not-date"
  | "not-timestamp"
  | "no-offset";

/**
 * A refusal, naming where: `row` is the index into `rows` (from 0) and `column` the declared
 * column's name, each `null` when the problem is not about one.
 */
export interface SeedRefusal {
  readonly problem: SeedProblem;
  readonly row: number | null;
  readonly column: string | null;
}

export interface SeedTableColumn {
  readonly name: string;
  readonly type: string;
}

export interface SeedTable {
  readonly columns: readonly SeedTableColumn[];
  readonly rows: readonly (readonly (string | null)[])[];
}

type CellProblem = Exclude<
  SeedProblem,
  | "too-many-columns"
  | "too-many-rows"
  | "too-large"
  | "duplicate-column"
  | "unknown-type"
  | "row-width"
>;

/**
 * Python's `str.isspace`, which agate's `strip()` uses, spelled out: JavaScript's `\s` would add
 * the byte-order mark, which Python does not count, and miss `\x1c`-`\x1f` and NEL, which it does.
 */
const PY_SPACE =
  "[\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const PY_STRIP = new RegExp(`^${PY_SPACE}+|${PY_SPACE}+$`, "gu");
/** The texts agate reads as NULL in a text column, once stripped and lower-cased. */
const TEXT_NULLS: ReadonlySet<string> = new Set(["", "null"]);
const NUL = "\u0000";
/** A UTF-16 surrogate standing alone: under the `u` flag a well-formed pair is one code point. */
const LONE_SURROGATE = /\p{Cs}/u;

const INTEGER = /^-?(?:0|[1-9][0-9]*)$/u;
const DECIMAL = /^-?(?<whole>0|[1-9][0-9]*)(?:\.(?<fraction>[0-9]+))?$/u;
const DATE = /^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})$/u;
const TIMESTAMP =
  /^(?<date>[0-9]{4}-[0-9]{2}-[0-9]{2})[T ](?<hour>[0-9]{2}):(?<minute>[0-9]{2}):(?<second>[0-9]{2})(?:\.[0-9]{1,6})?(?<offset>Z|[+-](?<offsetHour>[0-9]{2}):(?<offsetMinute>[0-9]{2}))?$/u;

/** `numeric(18,4)`: eighteen digits, four after the point. */
const NUMERIC_WHOLE_DIGITS = 14;
const NUMERIC_FRACTION_DIGITS = 4;
const INT4 = { min: -(2n ** 31n), max: 2n ** 31n - 1n } as const;
const INT8 = { min: -(2n ** 63n), max: 2n ** 63n - 1n } as const;
const MONTHS = 12;
const LAST_HOUR = 23;
const LAST_MINUTE = 59;
/** Postgres keeps an offset up to fifteen hours fifty-nine either way. */
const LAST_OFFSET_HOUR = 15;
const LEAP_DAY_MONTH = 2;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const RADIX = 10;

function integerCell(value: string, range: { min: bigint; max: bigint }): CellProblem | null {
  if (!INTEGER.test(value)) {
    return "not-integer";
  }
  const parsed = BigInt(value);
  return parsed < range.min || parsed > range.max ? "out-of-range" : null;
}

function decimalCell(value: string): CellProblem | null {
  const groups = DECIMAL.exec(value)?.groups;
  if (groups === undefined) {
    return "not-decimal";
  }
  if ((groups.whole ?? "").length > NUMERIC_WHOLE_DIGITS) {
    return "too-many-digits";
  }
  return (groups.fraction ?? "").length > NUMERIC_FRACTION_DIGITS ? "too-many-decimals" : null;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** A real calendar day of years 1 to 9999: Postgres refuses year 0 and every impossible date. */
function isCalendarDate(text: string): boolean {
  const groups = DATE.exec(text)?.groups;
  if (groups === undefined) {
    return false;
  }
  const year = Number.parseInt(groups.year ?? "", RADIX);
  const month = Number.parseInt(groups.month ?? "", RADIX);
  const day = Number.parseInt(groups.day ?? "", RADIX);
  if (year < 1 || month < 1 || month > MONTHS || day < 1) {
    return false;
  }
  const leap = month === LEAP_DAY_MONTH && isLeapYear(year) ? 1 : 0;
  return day <= (DAYS_IN_MONTH[month - 1] ?? 0) + leap;
}

function atMost(text: string | undefined, last: number): boolean {
  return Number.parseInt(text ?? "", RADIX) <= last;
}

function timestampCell(value: string): CellProblem | null {
  const groups = TIMESTAMP.exec(value)?.groups;
  const valid =
    groups !== undefined &&
    isCalendarDate(groups.date ?? "") &&
    atMost(groups.hour, LAST_HOUR) &&
    atMost(groups.minute, LAST_MINUTE) &&
    atMost(groups.second, LAST_MINUTE);
  if (!valid) {
    return "not-timestamp";
  }
  if (groups.offset === undefined) {
    return "no-offset";
  }
  const offsetValid =
    groups.offset === "Z" ||
    (atMost(groups.offsetHour, LAST_OFFSET_HOUR) && atMost(groups.offsetMinute, LAST_MINUTE));
  return offsetValid ? null : "not-timestamp";
}

/** What is wrong with a value of a column of `type`, or `null` when Postgres reads it as written. */
function typedCell(type: string, value: string): CellProblem | null {
  switch (type) {
    case "integer":
      return integerCell(value, INT4);
    case "bigint":
      return integerCell(value, INT8);
    case "numeric(18,4)":
      return decimalCell(value);
    case "boolean":
      return value === "true" || value === "false" ? null : "not-boolean";
    case "date":
      return isCalendarDate(value) ? null : "not-date";
    case "timestamptz":
      return timestampCell(value);
    default:
      return TEXT_NULLS.has(value.replace(PY_STRIP, "").toLowerCase()) ? "reads-as-null" : null;
  }
}

/** What is wrong with one cell, or `null`. A `null` cell is NULL in any column. */
function cellProblem(type: string, value: string | null): CellProblem | null {
  if (value === null) {
    return null;
  }
  if (value.includes(NUL) || LONE_SURROGATE.test(value)) {
    return "unstorable-character";
  }
  if (value.length > MAX_SEED_CELL_CHARS) {
    return "cell-too-long";
  }
  if (value.includes("\r")) {
    return "carriage-return";
  }
  return typedCell(type, value);
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(SEED_COLUMN_TYPES);

function shapeRefusal(table: SeedTable): SeedRefusal | null {
  if (table.columns.length > MAX_SEED_COLUMNS) {
    return { problem: "too-many-columns", row: null, column: null };
  }
  if (table.rows.length > MAX_SEED_ROWS) {
    return { problem: "too-many-rows", row: null, column: null };
  }
  const stored = JSON.stringify({ columns: table.columns, rows: table.rows });
  if (new TextEncoder().encode(stored).length > MAX_SEED_BYTES) {
    return { problem: "too-large", row: null, column: null };
  }
  const seen = new Set<string>();
  for (const column of table.columns) {
    if (seen.has(column.name)) {
      return { problem: "duplicate-column", row: null, column: column.name };
    }
    seen.add(column.name);
    if (!KNOWN_TYPES.has(column.type)) {
      return { problem: "unknown-type", row: null, column: column.name };
    }
  }
  return null;
}

/**
 * Why the table may not be stored, at the first place it fails, or `null` when every cell is a
 * value of its column's type that dbt will load unchanged. Bounds and columns are read first, so
 * a table too large to keep is refused before a cell of it is looked at.
 */
export function seedRefusal(table: SeedTable): SeedRefusal | null {
  const shape = shapeRefusal(table);
  if (shape !== null) {
    return shape;
  }
  for (const [row, cells] of table.rows.entries()) {
    if (cells.length !== table.columns.length) {
      return { problem: "row-width", row, column: null };
    }
    for (const [at, column] of table.columns.entries()) {
      const problem = cellProblem(column.type, cells[at] ?? null);
      if (problem !== null) {
        return { problem, row, column: column.name };
      }
    }
  }
  return null;
}

/** A value as one CSV field: always quoted, a quote doubled. `null` is the empty field. */
function field(value: string | null): string {
  return value === null ? "" : `"${value.replaceAll('"', '""')}"`;
}

/**
 * The table as the CSV file dbt loads, for a table `seedRefusal` admitted.
 *
 * RFC 4180 as Python's reader takes it: a header of the column names, which are identifiers and
 * need no quotes, then one line per row. Every value is quoted, so nothing in one -- a comma, a
 * quote, a line feed -- is read as syntax; `null` alone is unquoted and empty, which is how the
 * loader reads NULL. Lines end in `\n`, and there is no byte-order mark.
 *
 * Not `@undercroft/contracts/csv`: that encoder is for a file a person opens in a spreadsheet,
 * and it puts a quote before any text that starts like a formula -- which here would be a
 * change to the value dbt loads.
 */
export function seedCsv(table: SeedTable): string {
  const header = table.columns.map((column) => column.name).join(",");
  const lines = table.rows.map((cells) =>
    table.columns.map((_, at) => field(cells[at] ?? null)).join(","),
  );
  return `${[header, ...lines].join("\n")}\n`;
}
