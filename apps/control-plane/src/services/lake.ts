/**
 * The raw lake as the Lake division reads it: a summary for every member, the rows for an
 * admin.
 *
 * Two readers, two levels of exposure. The summary is counts and instants per stream --
 * how many deals, when the newest was seen -- and carries nothing a person wrote, so any
 * member of the tenant may read it; it is the honest answer to "did anything land". The
 * rows are the source's payloads verbatim, which for a CRM is names and addresses and for
 * a mailbox is whatever the mail said; that is admin-only (D11), decided in the handler's
 * role gate and stated here so the two files agree on why.
 *
 * Nothing here decides a status code. `records` for a stream that has nothing returns an
 * empty page, which is what it is: absence, not an error.
 *
 * ## The rows one run wrote, and the ones it no longer names
 *
 * `records` and `documents` also page one run's rows (ADR 0091): what a run's created and
 * changed counts open onto. A row names only the run that LAST wrote it, so a record a later run
 * changed names that run now, and the page is shorter than the run's count by exactly those.
 * Presenting the shorter page as the run's whole output would be a count with its constituents
 * quietly missing (ADR 0039), so the page carries {@link RunWrites}: the run's own count, the
 * rows that still name it, and the difference -- computed, and `null` whenever the two figures
 * cannot honestly be subtracted.
 */

import type { RawSearchResponse, SearchKind } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import { entitiesForRuns, getRun, type Run } from "@undercroft/db/repos";

import type { WorkerClient, WorkerOutcome } from "./workerClient.ts";
import {
  countDocumentsOfRun,
  countRecordsOfRun,
  type DocumentSummary,
  listDocuments,
  listRecords,
  type Page,
  type RawDocument,
  type RawRecord,
  type RecordStreamSummary,
  summariseDocuments,
  summariseRecords,
} from "../repos/rawLake.ts";

export type {
  DocumentSummary,
  Page,
  RawDocument,
  RawRecord,
  RecordStreamSummary,
} from "../repos/rawLake.ts";

export interface LakeSummary {
  readonly records: RecordStreamSummary[];
  readonly documents: DocumentSummary[];
}

export async function summary(exec: SqlExecutor, tenantId: string): Promise<LakeSummary> {
  const [recordStreams, documentStreams] = await Promise.all([
    summariseRecords(exec, tenantId),
    summariseDocuments(exec, tenantId),
  ]);
  return { records: recordStreams, documents: documentStreams };
}

/**
 * What one run wrote into a stream, against what still names it.
 *
 * `wrote` is the run's own created + changed for the stream (`ops.run_entity`, the figure on its
 * leaf); `current` is the rows that still carry its id; `rewritten` is the one taken from the
 * other -- the records a later run has changed since, which now name that run instead.
 */
export interface RunWrites {
  readonly runId: string;
  readonly wrote: number;
  readonly current: number;
  readonly rewritten: number;
}

/** A page of a stream, and -- when it was asked for one run's rows -- what that run wrote. */
export interface StreamPage<T> extends Page<T> {
  /** `null` when no run was asked for, or when its figures cannot answer; see {@link writesOf}. */
  readonly ofRun: RunWrites | null;
}

/**
 * The entity a run's ledger counts a source's documents under. Gmail and Drive both count their
 * catalogue rows as `documents` beside their records (`docs/reference/run-counts.md`).
 */
const DOCUMENTS_ENTITY = "documents";

/**
 * What `run` wrote into one stream, or `null` when that cannot be said without guessing.
 *
 * Four ways it cannot, each answered with nothing rather than a number:
 * - the run is of another source, so the rows asked about are not its rows at all;
 * - the run is still going, and its counts are not written until it settles;
 * - its ledger has no count for the stream -- a lake-API batch counts only on the run itself,
 *   and a run that read nothing of the stream has no row for it;
 * - more rows name it than it counted, which no rewrite explains. The two figures disagree, and
 *   subtracting them would print a number that is true of nothing.
 */
async function writesOf(
  exec: SqlExecutor,
  run: Run,
  stream: { source: string; entity: string },
  current: () => Promise<number>,
): Promise<RunWrites | null> {
  if (run.source !== stream.source || run.status === "running") {
    return null;
  }
  const counted = (await entitiesForRuns(exec, [run.id]))
    .get(run.id)
    ?.find((row) => row.entity === stream.entity);
  if (counted === undefined) {
    return null;
  }
  const wrote = counted.created + counted.changed;
  const still = await current();
  return still > wrote ? null : { runId: run.id, wrote, current: still, rewritten: wrote - still };
}

/**
 * One stream's rows, or one run's rows in it.
 *
 * A run id that is not one of this tenant's runs is not an error here: its page is empty (every
 * statement is scoped to the tenant) and it has no {@link RunWrites}, which is the same answer as
 * a run of this tenant's that wrote nothing to the stream -- so the answer confirms nothing about
 * another customer's run, as `runs.get`'s NOT_FOUND confirms nothing.
 */
export async function records(
  exec: SqlExecutor,
  tenantId: string,
  input: {
    source: string;
    entity: string;
    limit: number;
    cursor?: string | null;
    runId?: string | null;
  },
): Promise<StreamPage<RawRecord>> {
  const runId = input.runId ?? null;
  const run = runId === null ? null : await getRun(exec, tenantId, runId);
  const page = await listRecords(
    exec,
    tenantId,
    { source: input.source, entity: input.entity, runId },
    { limit: input.limit, cursor: input.cursor ?? null },
  );
  const ofRun =
    run === null
      ? null
      : await writesOf(exec, run, { source: input.source, entity: input.entity }, () =>
          countRecordsOfRun(exec, tenantId, {
            source: input.source,
            entity: input.entity,
            runId: run.id,
          }),
        );
  return { ...page, ofRun };
}

/** One source's document catalogue, or one run's rows in it, as {@link records} reads a run. */
export async function documents(
  exec: SqlExecutor,
  tenantId: string,
  input: { source: string; limit: number; cursor?: string | null; runId?: string | null },
): Promise<StreamPage<RawDocument>> {
  const runId = input.runId ?? null;
  const run = runId === null ? null : await getRun(exec, tenantId, runId);
  const page = await listDocuments(
    exec,
    tenantId,
    { source: input.source, runId },
    { limit: input.limit, cursor: input.cursor ?? null },
  );
  const ofRun =
    run === null
      ? null
      : await writesOf(exec, run, { source: input.source, entity: DOCUMENTS_ENTITY }, () =>
          countDocumentsOfRun(exec, tenantId, { source: input.source, runId: run.id }),
        );
  return { ...page, ofRun };
}

/**
 * One question over the whole lake, asked of the worker.
 *
 * NO `exec` AND NO REPO, unlike everything above it in this file, and the asymmetry is the
 * point: `summary`, `records` and `documents` read tables the control plane holds SELECT on,
 * and search reaches `raw.document_text.text`, which it deliberately does not (180's
 * docstring). So it goes the way `lake.query` goes -- through the worker, as the tenant's own
 * dbt login -- and this function exists to make that a decision a reader can see rather than a
 * detail buried in the handler. ADR 0026.
 */
export function search(
  worker: WorkerClient,
  tenantId: string,
  input: { q: string; kinds?: readonly SearchKind[]; limit: number; offset: number },
): Promise<WorkerOutcome<RawSearchResponse>> {
  return worker.searchRaw({
    tenantId,
    q: input.q,
    ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
    limit: input.limit,
    offset: input.offset,
  });
}
