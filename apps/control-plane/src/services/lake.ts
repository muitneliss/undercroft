/**
 * The raw lake as the Lake division reads it: a summary, and the rows.
 *
 * Two levels of exposure. The summary is counts and instants per stream -- how many deals,
 * when the newest was seen -- and carries nothing a person wrote; it is the honest answer to
 * "did anything land". The rows are the source's payloads verbatim, which for a CRM is names
 * and addresses and for a mailbox is whatever the mail said. Both are a holder of `lake:read`'s,
 * decided in the handler's gate (ADR 0139, and for the summary ADR 0147: which streams a
 * customer lands, and how much of each, is not every member's either).
 *
 * Nothing here decides a status code. `records` for a stream that has nothing returns an
 * empty page, which is what it is: absence, not an error.
 *
 * ## What a reader reaches (ADR 0142)
 *
 * Every read here is narrowed to the raw streams the reader reaches: `raw:<source>/<entity>`, a
 * whole source, or the lake. A stream outside it answers exactly as a stream with nothing in it
 * does -- an empty page, absent from the summary -- so the answer confirms nothing about it. The
 * search is narrowed INSIDE the worker's candidate lookups, before anything is ranked or
 * counted; narrowing its page afterwards would rank, count and cut matches the reader cannot see.
 * A source's document catalogue is its `documents` stream.
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
import { DOCUMENTS_ENTITY, type Reach, reachesStream } from "@undercroft/contracts/access";
import type { SqlExecutor } from "@undercroft/db";
import { entitiesForRuns, getRun, type Run } from "@undercroft/db/repos";

import { readSchema, type SchemaFilter, type SchemaOutcome } from "./tableSchema.ts";
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

/** The streams the reader reaches, with their counts; one they do not reach is not there. */
export async function summary(
  exec: SqlExecutor,
  tenantId: string,
  reach: Reach,
): Promise<LakeSummary> {
  const [recordStreams, documentStreams] = await Promise.all([
    summariseRecords(exec, tenantId),
    summariseDocuments(exec, tenantId),
  ]);
  return {
    records: recordStreams.filter((stream) => reachesStream(reach, stream.source, stream.entity)),
    documents: documentStreams.filter((stream) =>
      reachesStream(reach, stream.source, DOCUMENTS_ENTITY),
    ),
  };
}

/** The page a stream the reader does not reach answers with: the one an empty stream gets. */
function nothing<T>(): StreamPage<T> {
  return { items: [], nextCursor: null, ofRun: null };
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
    reach: Reach;
  },
): Promise<StreamPage<RawRecord>> {
  if (!reachesStream(input.reach, input.source, input.entity)) {
    return nothing();
  }
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
  input: {
    source: string;
    limit: number;
    cursor?: string | null;
    runId?: string | null;
    reach: Reach;
  },
): Promise<StreamPage<RawDocument>> {
  // The ledger counts a source's catalogue as its `documents` stream, and so does reach.
  if (!reachesStream(input.reach, input.source, DOCUMENTS_ENTITY)) {
    return nothing();
  }
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
  input: {
    q: string;
    kinds?: readonly SearchKind[] | undefined;
    limit: number;
    offset: number;
    reach: Reach;
  },
): Promise<WorkerOutcome<RawSearchResponse>> {
  const { raw } = input.reach;
  return worker.searchRaw({
    tenantId,
    q: input.q,
    ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
    limit: input.limit,
    offset: input.offset,
    streams:
      raw === "all"
        ? null
        : [
            ...raw.sources.map((source) => ({ source, entity: null })),
            ...raw.streams.map((stream) => ({ source: stream.source, entity: stream.entity })),
          ],
  });
}

/**
 * The `raw` schema's tables and columns, as the tenant's own login sees them, narrowed to
 * what `filter` names (`tableSchema.ts`). Through the worker for the reason `search` is.
 */
export function querySchema(
  worker: WorkerClient,
  tenantId: string,
  filter: SchemaFilter = {},
): Promise<SchemaOutcome> {
  return readSchema(() => worker.readRawSchema({ tenantId }), filter);
}
