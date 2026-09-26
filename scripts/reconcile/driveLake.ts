/**
 * The lake's side of Drive, and the cases that need no client: whether each `drive*` source's
 * files and documents were read to their end, whether every stored document has a file record,
 * and whether the extraction backlog is drained. The run-ledger regressions for the two
 * failures reported upstream live in `driveLedger.ts`.
 */

import { makeCase } from "./cases.ts";
import type { DriveRootConfig, LiveConfig, MailboxName } from "./config.ts";
import { messageOf } from "./errors.ts";
import type { EvidenceSink } from "./evidence.ts";
import type { GoogleClient } from "./google.ts";
import { arrayOrEmpty, text } from "./json.ts";
import type { TestResult } from "./model.ts";
import type { OstwinReader } from "./ostwin.ts";
import type { Walk } from "./paginate.ts";
import type {
  Connection,
  LakeDocument,
  LakeRecord,
  LakeSummary,
  Run,
  SummaryDocuments,
  UndercroftReader,
} from "./undercroft.ts";

export interface DriveDeps {
  readonly config: LiveConfig;
  readonly ostwin: OstwinReader;
  readonly undercroft: UndercroftReader;
  readonly google: Readonly<Record<MailboxName, GoogleClient>>;
  readonly sink: EvidenceSink;
}

export interface LakeSource {
  readonly source: string;
  readonly files: Walk<LakeRecord> | null;
  readonly documents: Walk<LakeDocument> | null;
  readonly error: string | null;
  readonly fileTypes: ReadonlySet<string>;
  /** Start of the last completed run that read `files`; null while none has completed. */
  readonly filesWatermark: number | null;
  readonly documentsWatermark: number | null;
  readonly byId: ReadonlyMap<string, readonly LakeRecord[]>;
  readonly documentIds: ReadonlyMap<string, LakeDocument>;
}

export interface LakeContext {
  readonly runs: readonly Run[];
  readonly summary: LakeSummary;
  readonly connections: readonly Connection[];
}

/**
 * The start of the last run that completed AND read something. A run that finished having
 * landed nothing, while the lake holds thousands of files, did not read the tree -- the live
 * ledger shows exactly that on 2026-09-24 -- so it cannot vouch that an absent file is missing.
 */
export function lastRead(runs: readonly Run[], source: string, entity: string): number | null {
  const run = runs.find(
    (entry) =>
      entry.source === source &&
      entry.kind === "ingest" &&
      entry.status === "ok" &&
      entry.entities.includes(entity) &&
      (entry.counts?.landed ?? 0) + (entry.counts?.unchanged ?? 0) > 0,
  );
  return run === undefined ? null : Date.parse(run.startedAt);
}

async function walkSource(
  deps: DriveDeps,
  source: string,
  summary: LakeSummary,
): Promise<Pick<LakeSource, "files" | "documents" | "error">> {
  const declaredFiles = summary.records.find(
    (stream) => stream.source === source && stream.entity === "files",
  )?.records;
  const declaredDocuments = summary.documents.find((entry) => entry.source === source)?.documents;
  try {
    const files = await deps.undercroft.records(source, "files", declaredFiles);
    const documents = await deps.undercroft.documents(source, declaredDocuments);
    return { files, documents, error: null };
  } catch (error) {
    return { files: null, documents: null, error: messageOf(error) };
  }
}

export async function loadLakeSource(
  deps: DriveDeps,
  root: DriveRootConfig,
  context: LakeContext,
): Promise<LakeSource | null> {
  const source = root.undercroftSource;
  if (source === null) {
    return null;
  }
  const { files, documents, error } = await walkSource(deps, source, context.summary);
  const byId = new Map<string, LakeRecord[]>();
  for (const record of files?.items ?? []) {
    byId.set(record.sourceRecordId, [...(byId.get(record.sourceRecordId) ?? []), record]);
  }
  const connection = context.connections.find((entry) => entry.source === source);
  return {
    source,
    files,
    documents,
    error,
    fileTypes: new Set(arrayOrEmpty(connection?.config.fileTypes).map(text)),
    filesWatermark: lastRead(context.runs, source, "files"),
    documentsWatermark: lastRead(context.runs, source, "documents"),
    byId,
    documentIds: new Map(
      (documents?.items ?? []).map((document) => [document.documentId, document]),
    ),
  };
}

function walkProblems(lake: LakeSource): string[] {
  const problems: string[] = [];
  for (const [name, walk] of [
    ["files", lake.files],
    ["documents", lake.documents],
  ] as const) {
    if (walk !== null && !walk.exhausted) {
      problems.push(`${name} listing stopped before its end`);
    }
    if (walk !== null && walk.repeats.size > 0) {
      problems.push(`${name}: ${walk.repeats.size} id(s) on more than one page`);
    }
    if (walk !== null && (walk.shortBy ?? 0) !== 0) {
      problems.push(
        `${name}: walk ${walk.items.length} vs summary ${walk.items.length + (walk.shortBy ?? 0)}`,
      );
    }
  }
  return problems;
}

export function lakeWalkCase(deps: DriveDeps, lake: LakeSource, runs: readonly Run[]): TestResult {
  const running = runs.some((run) => run.source === lake.source && run.status === "running");
  const problems = walkProblems(lake);
  // A count that drifts while a run is landing is the run, not the listing.
  const onlyDrift = problems.every((problem) => problem.includes("vs summary"));
  let status: TestResult["status"] = problems.length === 0 ? "PASS" : "FAIL";
  if (lake.error !== null) {
    status = "BLOCKED";
  } else if (problems.length > 0 && onlyDrift && running) {
    status = "PENDING";
  }
  const facts = {
    error: lake.error,
    files: lake.files?.items.length ?? null,
    documents: lake.documents?.items.length ?? null,
    problems,
    runInProgress: running,
  };
  return makeCase(
    "drive",
    {
      id: `DR-U-PAGE-001-${lake.source}`,
      title: `The ${lake.source} lake files and documents are read to their end, once`,
    },
    {
      group: "integration",
      requirement: "REQ-GEN-02 pagination completeness",
      contract: "undercroft lake records/documents cursor paging; lake summary counts",
      preconditions: "Undercroft CLI reachable",
      expected: "exhausted, no repeats, counts = lake summary",
      actual: JSON.stringify(facts),
      status,
      reason: lake.error ?? problems.join("; "),
      evidence: [{ label: "walk", path: deps.sink.json(`DR-U-PAGE-${lake.source}`, facts) }],
    },
  );
}

/** Every stored document belongs to a file the lake knows (Undercroft-internal consistency). */
export function documentsHaveFilesCase(deps: DriveDeps, lake: LakeSource): TestResult {
  const orphans = (lake.documents?.items ?? []).filter(
    (document) => !lake.byId.has(document.documentId) && document.deletedAt === null,
  );
  const evidence = deps.sink.rows(
    `DR-U-DOCFILE-${lake.source}`,
    orphans.map((document) => ({
      documentId: document.documentId,
      contentType: document.contentType,
      runId: document.runId,
    })),
  );
  let status: TestResult["status"] = orphans.length === 0 ? "PASS" : "FAIL";
  if (lake.documents === null) {
    status = "BLOCKED";
  }
  return makeCase(
    "drive",
    {
      id: `DR-U-DOCFILE-001-${lake.source}`,
      title: `Every ${lake.source} document has a file record`,
    },
    {
      group: "integration",
      requirement: "REQ-DR-04 the lake's documents and file records describe the same files",
      contract:
        "drive connector: documents are fetched for listed files (documentId = Drive file id)",
      preconditions: "files and documents walked",
      expected: "0 live documents without a file record",
      actual: `${lake.documents?.items.length ?? 0} documents, ${lake.files?.items.length ?? 0} file records, ${orphans.length} document(s) without a file record`,
      status,
      reason:
        lake.error ??
        (orphans.length === 0 ? "" : `${orphans.length} live document(s) have no file record`),
      evidence: [{ label: "orphan documents", path: evidence }],
    },
  );
}

export function extractionBacklogCase(
  deps: DriveDeps,
  lake: LakeSource,
  documents: SummaryDocuments | undefined,
): TestResult {
  const waiting = documents?.waiting ?? 0;
  let status: TestResult["status"] = waiting === 0 ? "PASS" : "PENDING";
  if (documents === undefined) {
    status = "BLOCKED";
  }
  return makeCase(
    "drive",
    {
      id: `DR-U-EXTRACT-001-${lake.source}`,
      title: `The ${lake.source} extraction backlog is drained`,
    },
    {
      group: "integration",
      requirement: "REQ-DR-05 every stored document is read or refused with a reason",
      contract: "lake summary documents: readable / refused (reasons) / waiting",
      finding: "undercroft issue #218 (NUL stalls extraction)",
      preconditions: "lake summary readable",
      expected: "waiting = 0",
      actual:
        documents === undefined
          ? "no documents summary"
          : `documents ${documents.documents}, readable ${documents.readable}, refused ${documents.refused}, waiting ${waiting}`,
      status,
      reason: status === "PASS" ? "" : `${waiting} document(s) not yet read`,
      evidence: [
        {
          label: "summary",
          path: deps.sink.json(`DR-U-EXTRACT-${lake.source}`, documents ?? null),
        },
      ],
    },
  );
}
