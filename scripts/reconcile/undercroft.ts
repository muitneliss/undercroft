/**
 * Reading Undercroft through its published CLI, `undercroft --agent`, and nothing else.
 *
 * READ COMMANDS ONLY, BY NAME. The CLI mixes reads with writes (`connections set-scope`, `keys
 * mint`) and labels `lake query` a write even though it runs a SELECT. The suite's promise is
 * that it never changes the system it audits, so the adapter holds an allow-list of the read
 * procedures it uses and refuses anything else before a process is spawned. A guard that
 * relied on the tenant's `allowWrites=false` would be relying on the thing under test.
 *
 * THE LAKE IS WALKED TO ITS END. `lake records` answers 50 rows a page with an opaque cursor.
 * Every walk goes through `walkPages`, so a cap, a repeating cursor, a row delivered twice or
 * a total the walk falls short of is reported rather than folded into "the lake holds N".
 */

import { ReconcileError } from "./errors.ts";
import type { CommandRunner } from "./exec.ts";
import { asArray, asObject, objectOrEmpty, stringOrNull, text } from "./json.ts";
import {
  parseConnection,
  parseDocument,
  parseDocumentsSummary,
  parseRecord,
  parseRun,
  parseStream,
} from "./lakeParse.ts";
import { type Page, type Walk, walkPages } from "./paginate.ts";

/** The read procedures this suite may call. Anything else is refused. */
export const READ_COMMANDS: ReadonlySet<string> = new Set([
  "lake summary",
  "lake records",
  "lake documents",
  "connections list",
  "connections get",
  "runs list",
  "runs get",
]);

const PAGE_SIZE = 50;
const TRANSIENT: ReadonlySet<string> = new Set(["NETWORK_ERROR", "TIMEOUT"]);
const MAX_ATTEMPTS = 4;
/** Base wait between attempts; tests set it to zero through `retryDelayForTests`. */
let RETRY_MS = 2000;

/** Shorten the wait between retries, for the offline suite only. */
export function retryDelayForTests(ms: number): void {
  RETRY_MS = ms;
}

export interface LakeRecord {
  readonly source: string;
  readonly entity: string;
  readonly sourceRecordId: string;
  /** The payload as stored; parsed by the caller that knows the entity's shape. */
  readonly payload: unknown;
  readonly contentSha256: string;
  readonly observedAt: string;
  readonly runId: string;
  readonly deletedAt: string | null;
}

export interface LakeDocument {
  readonly source: string;
  readonly documentId: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly observedAt: string;
  readonly runId: string;
  readonly deletedAt: string | null;
}

export interface Run {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  readonly entities: readonly string[];
  readonly status: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly counts: Readonly<Record<string, number>> | null;
  readonly error: string | null;
}

export interface Connection {
  readonly kind: string;
  readonly source: string;
  readonly status: string;
  readonly externalAccountLabel: string;
  readonly config: Readonly<Record<string, unknown>>;
}

export interface SummaryStream {
  readonly source: string;
  readonly entity: string;
  readonly records: number;
  readonly tombstoned: number;
  readonly latestObservedAt: string;
}

export interface SummaryDocuments {
  readonly source: string;
  readonly documents: number;
  readonly readable: number;
  readonly refused: number;
  readonly waiting: number;
}

export interface LakeSummary {
  readonly records: readonly SummaryStream[];
  readonly documents: readonly SummaryDocuments[];
}

export interface UndercroftReader {
  summary: () => Promise<LakeSummary>;
  connections: () => Promise<readonly Connection[]>;
  runs: (limit: number) => Promise<readonly Run[]>;
  records: (source: string, entity: string, declaredTotal?: number) => Promise<Walk<LakeRecord>>;
  documents: (source: string, declaredTotal?: number) => Promise<Walk<LakeDocument>>;
}

/** Run one CLI procedure, refusing any that is not on the read allow-list before spawning. */
export async function callUndercroft(
  runner: CommandRunner,
  tenantId: string,
  command: string,
  flags: readonly string[],
): Promise<unknown> {
  if (!READ_COMMANDS.has(command)) {
    throw new ReconcileError(`refused: "${command}" is not a read this suite may call`, {
      code: "REFUSED",
    });
  }
  const argv = ["undercroft", ...command.split(" "), "--tenant-id", tenantId, ...flags, "--agent"];
  for (let attempt = 1; ; attempt += 1) {
    const { stdout, stderr, code } = await runner.run(argv);
    try {
      return unwrap(stdout, `${command} (exit ${code}) ${stderr.trim().slice(0, 200)}`);
    } catch (error) {
      // A dropped connection is the network's answer, not the lake's: ask again, a few times,
      // and only then let the case go BLOCKED. Any other error is the answer.
      const transient = error instanceof ReconcileError && TRANSIENT.has(error.code);
      if (!transient || attempt >= MAX_ATTEMPTS) {
        throw error;
      }
      await Bun.sleep(RETRY_MS * attempt);
    }
  }
}

export class UndercroftCli implements UndercroftReader {
  readonly #runner: CommandRunner;
  readonly #tenantId: string;
  readonly #maxPages: number;

  constructor(runner: CommandRunner, tenantId: string, maxPages = 10_000) {
    this.#runner = runner;
    this.#tenantId = tenantId;
    this.#maxPages = maxPages;
  }

  async summary(): Promise<LakeSummary> {
    const data = asObject(await this.#call("lake summary", []));
    return {
      records: asArray(data.records).map(parseStream),
      documents: asArray(data.documents).map(parseDocumentsSummary),
    };
  }

  async connections(): Promise<readonly Connection[]> {
    return asArray(await this.#call("connections list", [])).map(parseConnection);
  }

  async runs(limit: number): Promise<readonly Run[]> {
    const data = asObject(await this.#call("runs list", ["--limit", String(limit)]));
    return asArray(data.items).map(parseRun);
  }

  records(source: string, entity: string, declaredTotal?: number): Promise<Walk<LakeRecord>> {
    const flags = ["--source", source, "--entity", entity];
    return walkPages((cursor) => this.#page("lake records", flags, cursor, parseRecord), {
      maxPages: this.#maxPages,
      idOf: (record) => record.sourceRecordId,
      ...(declaredTotal === undefined ? {} : { declaredTotal }),
    });
  }

  documents(source: string, declaredTotal?: number): Promise<Walk<LakeDocument>> {
    const flags = ["--source", source];
    return walkPages((cursor) => this.#page("lake documents", flags, cursor, parseDocument), {
      maxPages: this.#maxPages,
      idOf: (document) => document.documentId,
      ...(declaredTotal === undefined ? {} : { declaredTotal }),
    });
  }

  #call(command: string, flags: readonly string[]): Promise<unknown> {
    return callUndercroft(this.#runner, this.#tenantId, command, flags);
  }

  async #page<T>(
    command: string,
    flags: readonly string[],
    cursor: string | null,
    parse: (item: unknown) => T,
  ): Promise<Page<T>> {
    const paging = ["--limit", String(PAGE_SIZE), ...(cursor === null ? [] : ["--cursor", cursor])];
    const data = asObject(await this.#call(command, [...flags, ...paging]));
    return { items: asArray(data.items).map(parse), next: stringOrNull(data.nextCursor) };
  }
}

export function createUndercroftReader(
  runner: CommandRunner,
  tenantId: string,
  maxPages = 10_000,
): UndercroftReader {
  return new UndercroftCli(runner, tenantId, maxPages);
}

/** Unwrap the CLI's `{ok, data}` envelope; an `ok:false` becomes an error carrying its code. */
export function unwrap(stdout: string, context: string): unknown {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch (cause) {
    throw new ReconcileError(`not a CLI envelope: ${context}: ${stdout.slice(0, 200)}`, {
      code: "PARSE",
      cause,
    });
  }
  const body = asObject(envelope);
  if (body.ok === true) {
    return body.data;
  }
  const error = objectOrEmpty(body.error);
  throw new ReconcileError(`${context}: ${text(error.message)}`, {
    code: typeof error.code === "string" ? error.code : "UNKNOWN",
  });
}
