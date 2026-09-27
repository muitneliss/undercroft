/**
 * Undercroft through its published CLI, and nothing else: never a database.
 *
 * READ COMMANDS ONLY, BY NAME. The CLI mixes reads with writes, so the reader holds an allow-list
 * of the read procedures it uses and refuses anything else before a process is spawned. A guard
 * that relied on the profile's `allowWrites=false` would rely on the thing under audit.
 */

import { type CommandRunner, int, type Listing, list, obj, str, strOrNull, walk } from "./reads.ts";

export const READ_COMMANDS: ReadonlySet<string> = new Set([
  "lake summary",
  "lake records",
  "lake documents",
  "connections list",
  "runs list",
  "runs get",
]);

const TRANSIENT = new Set(["NETWORK_ERROR", "TIMEOUT"]);

/** A Drive `files` record as the lake holds it: the payload fields the contract preserves. */
export interface LakeFile {
  readonly id: string;
  readonly runId: string;
  readonly mimeType: string;
  readonly size: string;
  readonly md5: string;
  readonly modifiedTime: string;
  readonly parents: readonly string[];
}

export interface LakeDocument {
  readonly id: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly deletedAt: string | null;
}

export interface Run {
  readonly id: string;
  readonly source: string;
  readonly kind: string;
  readonly status: string;
  readonly entities: readonly string[];
  readonly startedAt: string;
  /** Records the run landed or found unchanged: zero means it read nothing. */
  readonly touched: number;
}

export interface Connection {
  readonly source: string;
  readonly picks: readonly { id: string; kind: string }[];
  readonly recurse: boolean;
  readonly fileTypes: readonly string[];
  /** sha256 of the selection, to show a change between the start and the end of a run. */
  readonly hash: string;
}

export interface Summary {
  readonly files: ReadonlyMap<string, number>;
  readonly documents: ReadonlyMap<string, number>;
}

export class UndercroftReader {
  readonly #runner: CommandRunner;
  readonly #base: readonly string[];
  readonly #retryMs: number;

  constructor(runner: CommandRunner, tenantId: string, profile?: string, retryMs = 2000) {
    this.#runner = runner;
    this.#base = [
      "--tenant-id",
      tenantId,
      ...(profile === undefined ? [] : ["--profile", profile]),
    ];
    this.#retryMs = retryMs;
  }

  /** Run one CLI read, refusing any procedure not on the allow-list before spawning. */
  async call(command: string, flags: readonly string[] = []): Promise<unknown> {
    if (!READ_COMMANDS.has(command)) {
      throw new Error(`refused: "${command}" is not a read this suite may call`);
    }
    const argv = ["undercroft", ...command.split(" "), ...this.#base, ...flags, "--agent"];
    for (let attempt = 1; ; attempt += 1) {
      const { stdout, code } = await this.#runner.run(argv);
      let body: Record<string, unknown>;
      try {
        body = obj(JSON.parse(stdout));
      } catch (cause) {
        throw new Error(`${command} (exit ${code}): not a CLI envelope`, { cause });
      }
      if (body.ok === true) {
        return body.data;
      }
      const error = obj(body.error ?? {});
      if (!TRANSIENT.has(str(error.code)) || attempt >= 4) {
        throw new Error(`${command}: ${str(error.code)} ${str(error.message)}`);
      }
      await Bun.sleep(this.#retryMs * attempt);
    }
  }

  async summary(): Promise<Summary> {
    const data = obj(await this.call("lake summary"));
    const files = new Map<string, number>();
    for (const row of list(data.records).map(obj)) {
      if (str(row.entity) === "files") {
        files.set(str(row.source), int(row.records));
      }
    }
    const documents = new Map(
      list(data.documents)
        .map(obj)
        .map((row) => [str(row.source), int(row.documents)] as const),
    );
    return { files, documents };
  }

  async connections(): Promise<readonly Connection[]> {
    return list(await this.call("connections list"))
      .map(obj)
      .map((row) => {
        const config = obj(row.config ?? {});
        const picks = list(config.files)
          .map(obj)
          .map((pick) => ({ id: str(pick.id), kind: str(pick.kind) }));
        const recurse = config.recurse === true;
        const fileTypes = list(config.fileTypes).map(str);
        const hasher = new Bun.CryptoHasher("sha256");
        hasher.update(JSON.stringify({ picks, recurse, fileTypes }));
        return { source: str(row.source), picks, recurse, fileTypes, hash: hasher.digest("hex") };
      });
  }

  /** The newest runs, one page: enough to see a run start or still running. */
  async recentRuns(limit = 50): Promise<readonly Run[]> {
    return list(obj(await this.call("runs list", ["--limit", String(limit)])).items).map(parseRun);
  }

  /** The whole run ledger, newest first. */
  allRuns(): Promise<Listing<Run>> {
    return walk(
      (cursor) => this.#page("runs list", [], cursor, parseRun),
      (run) => run.id,
    );
  }

  /** The refusals a run recorded; `pruned` when the run's list was cut short. */
  async refusals(runId: string): Promise<{ refusals: Map<string, string>; pruned: boolean }> {
    const data = obj(await this.call("runs get", ["--run-id", runId]));
    const refusals = new Map(
      list(data.refusals)
        .map(obj)
        .map((row) => [str(row.sourceRecordId), str(row.reason)] as const),
    );
    return { refusals, pruned: data.refusalsPruned === true };
  }

  files(source: string): Promise<Listing<LakeFile>> {
    const flags = ["--source", source, "--entity", "files"];
    return walk(
      (cursor) => this.#page("lake records", flags, cursor, parseFile),
      (row) => row.id,
    );
  }

  documents(source: string): Promise<Listing<LakeDocument>> {
    const flags = ["--source", source];
    return walk(
      (cursor) => this.#page("lake documents", flags, cursor, parseDocument),
      (row) => row.id,
    );
  }

  async #page<T>(
    command: string,
    flags: readonly string[],
    cursor: string | null,
    parse: (item: unknown) => T,
  ): Promise<{ items: readonly T[]; next: string | null }> {
    const paging = ["--limit", "50", ...(cursor === null ? [] : ["--cursor", cursor])];
    const data = obj(await this.call(command, [...flags, ...paging]));
    return { items: list(data.items).map(parse), next: strOrNull(data.nextCursor) };
  }
}

function parseRun(item: unknown): Run {
  const row = obj(item);
  const counts = obj(row.counts ?? {});
  return {
    id: str(row.id),
    source: str(row.source),
    kind: str(row.kind),
    status: str(row.status),
    entities: list(row.entities).map(str),
    startedAt: str(row.startedAt),
    touched: int(counts.landed) + int(counts.unchanged),
  };
}

function parseFile(item: unknown): LakeFile {
  const row = obj(item);
  const payload = obj(typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload);
  return {
    id: str(row.sourceRecordId),
    runId: str(row.runId),
    mimeType: str(payload.mimeType),
    size: str(payload.size),
    md5: str(payload.md5Checksum),
    modifiedTime: str(payload.modifiedTime),
    parents: list(payload.parents).map(str),
  };
}

function parseDocument(item: unknown): LakeDocument {
  const row = obj(item);
  return {
    id: str(row.documentId),
    contentType: str(row.contentType),
    bytes: int(row.bytes),
    sha256: str(row.sha256),
    deletedAt: strOrNull(row.deletedAt),
  };
}
