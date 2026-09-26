/**
 * `python3 scripts/ask.py`, stood in for the offline suite (`.claude/rules/tests.md`: no mocks).
 *
 * `sql` executes the query for real, on the SQLite handle the test passes in, and prints it the
 * way ask.py does -- cells clipped to 60 characters, joined with ` | `, newlines flattened, a
 * row-count footer, the "CÒN NỮA" marker past the limit -- so the chunked transport is tested
 * against the clipping it exists to defeat. Named Gmail queries print JSON Lines with ask.py's
 * footer and its 1..200 limit. Anything else ask.py can do is refused.
 */

import type { CommandResult, CommandRunner } from "./exec.ts";

const MAX_CELL = 60;
const NEWLINES = /\n/gu;

function clip(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value).replace(NEWLINES, " ");
  return text.length <= MAX_CELL ? text : `${text.slice(0, MAX_CELL - 1)}…`;
}

export interface NamedAnswer {
  readonly header: string;
  readonly rows: readonly Record<string, unknown>[];
}

/** The part of a SQLite handle the stand-in uses: `bun:sqlite`'s `Database` satisfies it. */
export interface SqlDatabase {
  prepare: (sql: string) => { values: () => unknown[][]; readonly columnNames: string[] };
}

export class AskPy implements CommandRunner {
  readonly db: SqlDatabase;
  readonly #named = new Map<string, NamedAnswer>();
  readonly calls: string[][] = [];
  header = "# mart client-master.db · built 2026-09-25T08:07 · tables=1 rows=1 · contract=PASS";

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  /** Record the answer to `ask.py q <query> <caseId>`. */
  named(query: string, caseId: string, answer: NamedAnswer): this {
    this.#named.set(`${query} ${caseId}`, answer);
    return this;
  }

  run(argv: readonly string[]): Promise<CommandResult> {
    this.calls.push([...argv]);
    const [python, script, command, ...rest] = argv;
    if (python !== "python3" || script !== "scripts/ask.py") {
      return Promise.reject(
        new Error(`AskPy only answers python3 scripts/ask.py, got ${argv.join(" ")}`),
      );
    }
    const limitAt = rest.indexOf("--limit");
    const limit = limitAt === -1 ? 50 : Number.parseInt(rest[limitAt + 1] ?? "50", 10);
    const noHeader = rest.includes("--no-header");
    if (command === "sql") {
      return Promise.resolve(this.#sql(rest[0] ?? "", limit, noHeader));
    }
    if (command === "q") {
      return Promise.resolve(this.#q(rest[0] ?? "", rest[1] ?? "", limit));
    }
    return Promise.reject(new Error(`AskPy does not model ask.py ${command ?? ""}`));
  }

  #sql(query: string, limit: number, noHeader: boolean): CommandResult {
    const statement = this.db.prepare(query);
    const rows = statement.values();
    const columns = statement.columnNames;
    const lines: string[] = noHeader ? [] : [this.header];
    lines.push(columns.join(" | "));
    const shown = rows.slice(0, limit);
    for (const row of shown) {
      lines.push(row.map(clip).join(" | "));
    }
    const more = rows.length > limit ? " — CÒN NỮA, thêm WHERE/LIMIT để thu hẹp" : "";
    lines.push(`(${shown.length} dòng${more})`);
    return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
  }

  #q(query: string, caseId: string, limit: number): CommandResult {
    if (limit < 1 || limit > 200) {
      return {
        code: 1,
        stdout: "",
        stderr: "Gmail source unavailable: unknown source query or limit outside 1..200\n",
      };
    }
    const answer = this.#named.get(`${query} ${caseId}`);
    if (answer === undefined) {
      return {
        code: 1,
        stdout: "",
        stderr: `Gmail source unavailable: no answer for ${query} ${caseId}\n`,
      };
    }
    const rows = answer.rows.slice(0, limit);
    const lines = [answer.header, ...rows.map((row) => JSON.stringify(row))];
    lines.push(`(${rows.length} source rows; limit=${limit}; business review remains required)`);
    return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
  }
}
