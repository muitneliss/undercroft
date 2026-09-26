/**
 * Reading OSTWIN, the old warehouse, through its one read door: `python3 scripts/ask.py`.
 *
 * NOT THE DATABASE. The mart is a SQLite file, and opening it would be faster -- and would
 * also bypass the read-only check, the trust header and the stale flag that `ask.py` prints,
 * which are exactly what a reconciliation has to record. So every read goes through the CLI.
 *
 * TWO READ SHAPES, TWO LIMITS THIS ADAPTER DEFEATS RATHER THAN TRUSTS.
 * - Named queries (`ask.py q gmail-source-* CASE-ID`) print one JSON object per line, but
 *   refuse a limit above 200 and have no offset (its Gmail source module). A
 *   result of exactly `limit` rows is therefore reported as possibly truncated, never as
 *   complete.
 * - `ask.py sql` prints ` | `-joined cells, turns newlines into spaces and clips every cell to
 *   60 characters with a trailing ellipsis. Parsing that would read clipped subjects as content
 *   mismatches and split any value holding ` | `. So `fullRows` wraps the caller's SELECT: each
 *   row becomes the hex of a `json_object`, cut into 56-character chunks by a recursive CTE --
 *   short enough never to be clipped, and alphabet-safe -- and is reassembled here.
 */

import { ReconcileError } from "./errors.ts";
import type { CommandRunner } from "./exec.ts";
import { asObject } from "./json.ts";

/** Hex characters per chunk: under ask.py's 60-character cell clip, and even. */
const CHUNK = 56;
const MART_HEADER = /^# mart (?<mart>\S+) · built (?<built>\S+) · .*contract=(?<contract>\w+)/u;
const NAMED_FOOTER = /^\((?<count>\d+) source rows; limit=\d+;/u;
const SQL_FOOTER = /^\(\d+ dòng/u;
const MORE_ROWS = "CÒN NỮA";
const HEX_PAIR = /../gu;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/u;
const TRAILING_SEMICOLON = /;$/u;

/** The row cap handed to `ask.py sql`; a result that reaches it is an error, not a read. */
const SQL_LIMIT = 5_000_000;

export interface MartWatermark {
  /** The mart file the answers came from. */
  readonly mart: string;
  /** When the mart was built: every OSTWIN answer is as of this moment, not as of now. */
  readonly builtAt: string;
  /** The mart's own contract gate, verbatim (PASS/FAIL). */
  readonly contract: string;
  /** True when `ask.py` itself flagged the mart stale. */
  readonly stale: boolean;
  /** The header line exactly as printed, for the evidence file. */
  readonly header: string;
}

export interface NamedResult {
  readonly header: string;
  readonly rows: readonly Record<string, unknown>[];
  readonly limit: number;
  /** The row count reached the limit, so rows past it may exist. Never treat as complete. */
  readonly possiblyTruncated: boolean;
}

export type Row = Record<string, string | null>;

export interface OstwinReader {
  watermark: () => Promise<MartWatermark>;
  named: (query: string, caseId: string, limit?: number) => Promise<NamedResult>;
  fullRows: (select: string, columns: readonly string[]) => Promise<Row[]>;
}

/** The reader over a real (or stand-in) `ask.py`, run from the old warehouse's repository root. */
export class AskPyReader implements OstwinReader {
  readonly #runner: CommandRunner;
  readonly #root: string;

  constructor(runner: CommandRunner, ostwinRoot: string) {
    this.#runner = runner;
    this.#root = ostwinRoot;
  }

  async watermark(): Promise<MartWatermark> {
    return parseWatermark(await this.#ask(["sql", "SELECT 1 AS probe"]));
  }

  async named(query: string, caseId: string, limit = 200): Promise<NamedResult> {
    const args = ["q", query, caseId, "--no-header", "--limit", String(limit)];
    return parseNamed(await this.#ask(args), limit);
  }

  async fullRows(select: string, columns: readonly string[]): Promise<Row[]> {
    const args = [
      "sql",
      chunkedSelect(select, columns),
      "--no-header",
      "--limit",
      String(SQL_LIMIT),
    ];
    return decodeChunks(await this.#ask(args), columns);
  }

  async #ask(args: readonly string[]): Promise<string> {
    const { code, stdout, stderr } = await this.#runner.run(
      ["python3", "scripts/ask.py", ...args],
      {
        cwd: this.#root,
      },
    );
    if (code !== 0) {
      throw new ReconcileError(
        `ask.py ${args[0] ?? ""} exited ${code}: ${stderr.trim().slice(0, 300)}`,
        {
          code: "OSTWIN",
        },
      );
    }
    return stdout;
  }
}

export function createOstwinReader(runner: CommandRunner, ostwinRoot: string): OstwinReader {
  return new AskPyReader(runner, ostwinRoot);
}

export function parseWatermark(stdout: string): MartWatermark {
  const header = stdout.split("\n").find((line) => line.startsWith("# mart ")) ?? "";
  const groups = MART_HEADER.exec(header)?.groups;
  if (groups === undefined) {
    throw new ReconcileError(
      "ask.py printed no mart trust header; cannot date the OSTWIN answers",
      {
        code: "OSTWIN",
      },
    );
  }
  return {
    mart: groups.mart ?? "",
    builtAt: groups.built ?? "",
    contract: groups.contract ?? "",
    stale: header.includes("STALE"),
    header,
  };
}

export function parseNamed(stdout: string, limit: number): NamedResult {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  const header = lines.find((line) => line.startsWith("#")) ?? "";
  const rows = lines.filter((line) => line.startsWith("{")).map(parseObject);
  const footer = lines.map((line) => NAMED_FOOTER.exec(line)?.groups?.count).find(Boolean);
  if (footer === undefined) {
    throw new ReconcileError("named query printed no row-count footer; the answer may be cut off", {
      code: "OSTWIN",
    });
  }
  if (Number.parseInt(footer, 10) !== rows.length) {
    throw new ReconcileError(`footer says ${footer} rows, ${rows.length} parsed`, {
      code: "OSTWIN",
    });
  }
  return { header, rows, limit, possiblyTruncated: rows.length >= limit };
}

function parseObject(line: string): Record<string, unknown> {
  return asObject(JSON.parse(line));
}

/**
 * Wrap a SELECT so that every row arrives whole: hex of a JSON object, in numbered chunks.
 *
 * Column names are interpolated into SQL, so they must be plain identifiers; anything else is
 * refused rather than quoted, because this runs against the only copy of the warehouse.
 */
export function chunkedSelect(select: string, columns: readonly string[]): string {
  if (columns.length === 0) {
    throw new ReconcileError("fullRows needs at least one column", { code: "OSTWIN" });
  }
  const refused = columns.find((column) => !IDENTIFIER.test(column));
  if (refused !== undefined) {
    throw new ReconcileError(`not a plain column name: ${refused}`, { code: "REFUSED" });
  }
  const pairs = columns.map((column) => `'${column}', ${column}`).join(", ");
  return [
    "WITH src AS (SELECT row_number() OVER () AS r,",
    `hex(json_object(${pairs})) AS h FROM (${select.trim().replace(TRAILING_SEMICOLON, "")})),`,
    "chunks(r, i, h) AS (SELECT r, 0, h FROM src UNION ALL",
    `SELECT r, i + 1, h FROM chunks WHERE (i + 1) * ${CHUNK} < length(h))`,
    `SELECT r, i, substr(h, i * ${CHUNK} + 1, ${CHUNK}) AS c FROM chunks ORDER BY r, i`,
  ].join(" ");
}

export function decodeChunks(stdout: string, columns: readonly string[]): Row[] {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  const footer = lines.find((line) => SQL_FOOTER.test(line));
  if (footer === undefined) {
    throw new ReconcileError("ask.py sql printed no row-count footer; the answer may be cut off", {
      code: "OSTWIN",
    });
  }
  if (footer.includes(MORE_ROWS)) {
    throw new ReconcileError(`ask.py sql stopped at its row limit: ${footer}`, { code: "OSTWIN" });
  }
  return [...collectChunks(lines).values()].map((parts) => toRow(parts.join(""), columns));
}

/** Row number -> its hex chunks in order; a chunk out of order is an error, not a guess. */
function collectChunks(lines: readonly string[]): Map<number, string[]> {
  const byRow = new Map<number, string[]>();
  for (const line of lines) {
    const cells = line.split(" | ");
    if (cells.length !== 3 || cells[0] === "r") {
      continue;
    }
    const [r = "", i = "", chunk = ""] = cells;
    const row = Number.parseInt(r, 10);
    const parts = byRow.get(row) ?? [];
    if (parts.length !== Number.parseInt(i, 10)) {
      throw new ReconcileError(`row ${row}: chunk ${i} arrived out of order`, { code: "OSTWIN" });
    }
    parts.push(chunk.trim());
    byRow.set(row, parts);
  }
  return byRow;
}

function toRow(hex: string, columns: readonly string[]): Row {
  const parsed = parseObject(hexToUtf8(hex));
  const row: Row = {};
  for (const column of columns) {
    const value = parsed[column];
    row[column] = value === null || value === undefined ? null : String(value);
  }
  return row;
}

function hexToUtf8(hex: string): string {
  const pairs = hex.match(HEX_PAIR) ?? [];
  const bytes = Uint8Array.from(pairs, (pair) => Number.parseInt(pair, 16));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** A SQL string literal; single quotes doubled. For CASE-IDs and ids, never free text. */
export function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
