/**
 * The `undercroft --agent` CLI, stood in for the offline suite over rows held in memory:
 * cursor paging at the requested limit, the `{ok, data}` envelope, and an error envelope for
 * any command it does not model. `routeCommands` sends each argv to the stand-in for its
 * system, as the live run's single runner does.
 */

import type { AskPy } from "./askPyStandIn.ts";
import type { CommandResult, CommandRunner } from "./exec.ts";

const OBSERVED = "2026-09-25T00:00:00.000Z";
const ZERO_SHA = "0".repeat(64);

export interface LakeRow {
  readonly source: string;
  readonly entity: string;
  readonly sourceRecordId: string;
  readonly payload: unknown;
  readonly runId?: string;
}

export interface LakeDocumentRow {
  readonly source: string;
  readonly documentId: string;
  readonly contentType: string;
  readonly bytes: number;
}

interface Paged<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

function ok(data: unknown): CommandResult {
  return { code: 0, stdout: JSON.stringify({ ok: true, data }), stderr: "" };
}

function flag(argv: readonly string[], name: string): string | null {
  const at = argv.indexOf(name);
  return at === -1 ? null : (argv[at + 1] ?? null);
}

function page<T>(rows: readonly T[], argv: readonly string[]): Paged<T> {
  const cursor = flag(argv, "--cursor");
  const limit = Number.parseInt(flag(argv, "--limit") ?? "50", 10);
  const start = cursor === null ? 0 : Number.parseInt(cursor, 10);
  const end = start + limit;
  return { items: rows.slice(start, end), nextCursor: end < rows.length ? String(end) : null };
}

export class LakeCli implements CommandRunner {
  readonly records: LakeRow[] = [];
  readonly documents: LakeDocumentRow[] = [];
  readonly calls: string[][] = [];
  connections: unknown[] = [];
  runs: unknown[] = [];

  run(argv: readonly string[]): Promise<CommandResult> {
    this.calls.push([...argv]);
    if (argv[0] !== "undercroft" || !argv.includes("--agent")) {
      return Promise.reject(
        new Error(`LakeCli only answers undercroft --agent, got ${argv.join(" ")}`),
      );
    }
    return Promise.resolve(this.#answer(`${argv[1] ?? ""} ${argv[2] ?? ""}`, argv));
  }

  #answer(command: string, argv: readonly string[]): CommandResult {
    if (command === "lake summary") {
      return ok(this.#summary());
    }
    if (command === "connections list") {
      return ok(this.connections);
    }
    if (command === "runs list") {
      return ok({ items: this.runs, nextCursor: null });
    }
    if (command === "lake records") {
      return ok(page(this.#records(argv), argv));
    }
    if (command === "lake documents") {
      return ok(page(this.#documents(argv), argv));
    }
    const error = { code: "UNKNOWN_COMMAND", message: `no command ${command}` };
    return { code: 1, stdout: JSON.stringify({ ok: false, error }), stderr: "" };
  }

  #records(argv: readonly string[]): Record<string, unknown>[] {
    const source = flag(argv, "--source");
    const entity = flag(argv, "--entity");
    return this.records
      .filter((row) => row.source === source && row.entity === entity)
      .map((row) => ({
        source: row.source,
        entity: row.entity,
        sourceRecordId: row.sourceRecordId,
        // The CLI sends the payload as indented JSON text; the adapter must parse it.
        payload: JSON.stringify(row.payload, null, 4),
        contentSha256: ZERO_SHA,
        observedAt: OBSERVED,
        runId: row.runId ?? "run-fixture",
        deletedAt: null,
      }));
  }

  #documents(argv: readonly string[]): Record<string, unknown>[] {
    const source = flag(argv, "--source");
    return this.documents
      .filter((row) => row.source === source)
      .map((row) => ({
        ...row,
        sha256: ZERO_SHA,
        observedAt: OBSERVED,
        runId: "run-fixture",
        deletedAt: null,
      }));
  }

  #summary(): Record<string, unknown> {
    const streams = new Map<string, { source: string; entity: string; records: number }>();
    for (const row of this.records) {
      const key = `${row.source}/${row.entity}`;
      const stream = streams.get(key) ?? { source: row.source, entity: row.entity, records: 0 };
      streams.set(key, { ...stream, records: stream.records + 1 });
    }
    const documents = new Map<string, number>();
    for (const row of this.documents) {
      documents.set(row.source, (documents.get(row.source) ?? 0) + 1);
    }
    return {
      records: [...streams.values()].map((stream) => ({
        ...stream,
        tombstoned: 0,
        latestObservedAt: OBSERVED,
      })),
      documents: [...documents].map(([source, total]) => ({
        source,
        documents: total,
        readable: total,
        refused: 0,
        waiting: 0,
      })),
    };
  }
}

/** Route each command to the stand-in for its system, as the live run's one runner does. */
export function routeCommands(ask: AskPy, lake: LakeCli): CommandRunner {
  return {
    run: (argv): Promise<CommandResult> =>
      argv[0] === "undercroft" ? lake.run(argv) : ask.run(argv),
  };
}
