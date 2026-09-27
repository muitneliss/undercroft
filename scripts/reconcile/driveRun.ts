/**
 * One Drive reconciliation run: read the connections, the run ledger, the lake and the picked
 * trees; judge every record; check the state held still; write the evidence outside the repo.
 *
 * ORDER. The selections and the ledger are read first, the lake and each tree next, then the
 * selections and the newest runs again. A selection that changed, or a `files` run that started,
 * while the reads ran makes the comparison one of two states: every defect found is then BLOCKED
 * rather than reported (`withPreconditions`), and so is every defect found over a read that was
 * not whole.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { DriveFile, DriveReader, DriveTree } from "./driveApi.ts";
import { type DriveConfig, writeEvidence } from "./driveConfig.ts";
import {
  type Evidence,
  hashSample,
  type Judged,
  judgeFile,
  judgeHash,
  judgeLakeOnly,
  type Ledger,
  type Outcome,
  outcomeOf,
  withPreconditions,
} from "./driveJudge.ts";
import { overCeiling, takes } from "./driveRules.ts";
import { type Listing, mapLimit } from "./reads.ts";
import type {
  Connection,
  LakeDocument,
  LakeFile,
  Run,
  Summary,
  UndercroftReader,
} from "./undercroftCli.ts";

/** One group of tests: a check per record, named by the case and the lake source. */
export interface Group {
  readonly id: string;
  readonly title: string;
  readonly records: readonly Judged[];
}

export interface DriveRun {
  readonly runId: string;
  readonly dir: string;
  readonly groups: readonly Group[];
  readonly outcome: Outcome;
}

export interface Readers {
  readonly undercroft: UndercroftReader;
  readonly drive: (source: string) => DriveReader;
}

interface Context {
  readonly readers: Readers;
  readonly config: DriveConfig;
  readonly connections: readonly Connection[];
  readonly ledger: Listing<Run>;
  readonly summary: Summary;
  readonly log: (line: string) => void;
}

/** The last completed `files` run that read something: its start is the mark. */
export function lastFilesRun(runs: readonly Run[], source: string): Run | undefined {
  return runs.find(
    (run) =>
      run.source === source &&
      run.kind === "ingest" &&
      run.status === "ok" &&
      run.entities.includes("files") &&
      run.touched > 0,
  );
}

/** Every refusal the source's `files` runs recorded, over the whole ledger. */
async function ledgerOf(context: Context, source: string): Promise<Ledger> {
  const reasons = new Map<string, string[]>();
  const accounted = new Set<string>();
  let complete = context.ledger.exhausted;
  for (const run of context.ledger.items) {
    if (run.source === source && run.entities.includes("files")) {
      accounted.add(run.id);
      const detail = await context.readers.undercroft.refusals(run.id);
      complete &&= !detail.pruned;
      for (const [id, reason] of detail.refusals) {
        reasons.set(id, [...(reasons.get(id) ?? []), reason]);
      }
    }
  }
  return { reasons, complete, accounted };
}

function preconditions(
  context: Context,
  connection: Connection,
  read: { tree: DriveTree; files: Listing<LakeFile>; documents: Listing<LakeDocument> },
): [string, string][] {
  const { tree, files, documents } = read;
  const wantFiles = context.summary.files.get(connection.source);
  const wantDocuments = context.summary.documents.get(connection.source);
  const treeWhole =
    tree.incomplete + tree.repeats + tree.unreadable.length === 0 && connection.picks.length > 0;
  const lakeWhole =
    files.exhausted &&
    documents.exhausted &&
    files.repeats + documents.repeats === 0 &&
    files.items.length === wantFiles &&
    documents.items.length === wantDocuments;
  return [
    [
      "tree",
      treeWhole
        ? ""
        : `Drive tree not read whole: ${tree.incomplete} listing(s) cut short, ${tree.repeats} repeat(s), ${tree.unreadable.length} unreadable pick(s), ${connection.picks.length} pick(s)`,
    ],
    [
      "lake",
      lakeWhole
        ? ""
        : `lake not read whole: records ${files.items.length} of ${wantFiles ?? "?"}, documents ${documents.items.length} of ${wantDocuments ?? "?"}, ${files.repeats + documents.repeats} repeat(s)`,
    ],
    [
      "run",
      lastFilesRun(context.ledger.items, connection.source) === undefined
        ? "no completed files run"
        : "",
    ],
  ];
}

/** The lake-only ids: records and live documents the tree's taken files do not account for. */
async function lakeOnly(
  context: Context,
  drive: DriveReader,
  inTree: ReadonlySet<string>,
  evidence: Evidence,
): Promise<Judged[]> {
  const live = [...evidence.documents.values()].filter((row) => row.deletedAt === null);
  const ids = [...new Set([...evidence.files.keys(), ...live.map((row) => row.id)])].filter(
    (id) => !inTree.has(id),
  );
  // A record whose document is marked deleted is judged by the lake alone: no lookup.
  const now = await mapLimit(ids, context.config.concurrency, (id) =>
    (evidence.documents.get(id)?.deletedAt ?? null) === null
      ? drive.file(id)
      : Promise.resolve(null),
  );
  return ids.map((id, index) => judgeLakeOnly(id, now[index] ?? null, evidence));
}

async function hashes(
  context: Context,
  drive: DriveReader,
  sample: readonly DriveFile[],
  evidence: Evidence,
): Promise<Judged[]> {
  const judged = await mapLimit(sample, Math.min(4, context.config.concurrency), async (file) => {
    const document = evidence.documents.get(file.id);
    try {
      return document === undefined ? null : judgeHash(file, document, await drive.digest(file.id));
    } catch (error) {
      const reason = `download failed: ${String(error)}`;
      return { id: file.id, verdict: "BLOCKED" as const, reason, fields: [] };
    }
  });
  return judged.filter((record) => record !== null);
}

async function reconcileSource(
  context: Context,
  connection: Connection,
): Promise<{ groups: Group[]; unmet: string[] }> {
  const { source } = connection;
  const drive = context.readers.drive(source);
  context.log(`${source}: reading the lake`);
  const files = await context.readers.undercroft.files(source);
  const documents = await context.readers.undercroft.documents(source);
  context.log(`${source}: ${files.items.length} record(s); walking the picked tree`);
  const tree = await drive.tree(connection.picks, connection.recurse, context.config.concurrency);
  const last = lastFilesRun(context.ledger.items, source);
  const inScope = tree.files.filter((file) =>
    takes(connection.fileTypes, file.mimeType, file.extension),
  );
  const evidence: Evidence = {
    mark: last === undefined ? null : Date.parse(last.startedAt),
    folders: tree.folders,
    files: new Map(files.items.map((row) => [row.id, row] as const)),
    documents: new Map(documents.items.map((row) => [row.id, row] as const)),
    ledger: files.items.some((row) => overCeiling(row.size))
      ? await ledgerOf(context, source)
      : null,
  };
  const fileRecords = inScope.map((file) => judgeFile(file, evidence));
  const verdicts = new Map(fileRecords.map((record) => [record.id, record] as const));
  const sample = hashSample(inScope, verdicts, evidence, context.config.hashSample);
  const checks = preconditions(context, connection, { tree, files, documents });
  const inTree = new Set(inScope.map((file) => file.id));
  return {
    groups: [
      precondition(source, checks),
      {
        id: `DR-FILE-${source}`,
        title:
          "every file under the picks, of a type the connection takes, is in the lake with Drive's fields and bytes",
        records: fileRecords,
      },
      {
        id: `DR-LAKE-ONLY-${source}`,
        title: "every lake record the picked tree no longer holds is marked deleted or explained",
        records: await lakeOnly(context, drive, inTree, evidence),
      },
      {
        id: `DR-HASH-${source}`,
        title: "sampled files: the lake's bytes are Drive's bytes (md5 = Drive, sha256 = lake)",
        records: await hashes(context, drive, sample, evidence),
      },
    ],
    unmet: checks.map(([, why]) => why).filter((why) => why.length > 0),
  };
}

function precondition(source: string, checks: readonly (readonly [string, string])[]): Group {
  return {
    id: `DR-PRE-${source}`,
    title: "the reads are whole and the state held still",
    records: checks.map(([id, unmet]) => ({
      id,
      verdict: unmet.length === 0 ? "MATCH" : "BLOCKED",
      reason: unmet,
      fields: [],
    })),
  };
}

/** Selection and ledger at the end against the start: nothing may have moved under the reads. */
function heldStill(
  context: Context,
  after: readonly Connection[],
  runs: readonly Run[],
  source: string,
): string {
  const seen = new Set(context.ledger.items.map((run) => run.id));
  const start = context.connections.find((entry) => entry.source === source);
  const end = after.find((entry) => entry.source === source);
  const files = runs.filter((run) => run.source === source && run.entities.includes("files"));
  const moved = [
    end?.hash === start?.hash ? "" : "the selection changed",
    files.some((run) => !seen.has(run.id)) ? "a files run started" : "",
    files.some((run) => run.status === "running") ? "a files run is running" : "",
  ].filter((line) => line.length > 0);
  return moved.length === 0 ? "" : `state moved during the reads: ${moved.join(", ")}`;
}

export async function runDrive(config: DriveConfig, readers: Readers): Promise<DriveRun> {
  const runId = new Date().toISOString().replaceAll(":", "").replace(".", "-");
  const dir = join(config.outDir, runId);
  mkdirSync(dir, { recursive: true });
  function log(line: string): void {
    appendFileSync(join(dir, "progress.log"), `${new Date().toISOString()} ${line}\n`);
  }
  log("reading the connections, the run ledger and the lake summary");
  const context: Context = {
    readers,
    config,
    connections: await readers.undercroft.connections(),
    ledger: await readers.undercroft.allRuns(),
    summary: await readers.undercroft.summary(),
    log,
  };
  const results: { source: string; groups: Group[]; unmet: string[] }[] = [];
  for (const { source } of config.connections) {
    const connection = context.connections.find((entry) => entry.source === source);
    results.push(
      connection === undefined
        ? {
            source,
            groups: [precondition(source, [["connection", "no such connection"]])],
            unmet: [],
          }
        : { source, ...(await reconcileSource(context, connection)) },
    );
  }
  const after = await readers.undercroft.connections();
  const runs = await readers.undercroft.recentRuns();
  const groups = results.flatMap(({ source, groups: found, unmet }) => {
    const moved = heldStill(context, after, runs, source);
    const still: Judged = {
      id: "still",
      verdict: moved === "" ? "MATCH" : "BLOCKED",
      reason: moved,
      fields: [],
    };
    const blockers = moved === "" ? unmet : [...unmet, moved];
    return found.map((group) =>
      group.id.startsWith("DR-PRE-")
        ? { ...group, records: [...group.records, still] }
        : { ...group, records: withPreconditions(group.records, blockers) },
    );
  });
  const outcome = outcomeOf(groups.flatMap((group) => group.records));
  writeEvidence(dir, { runId, groups, outcome });
  log(`done: ${outcome}`);
  return { runId, dir, groups, outcome };
}
