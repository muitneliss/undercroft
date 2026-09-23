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
 */

import type { RawSearchResponse, SearchKind } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";

import type { WorkerClient, WorkerOutcome } from "./workerClient.ts";
import {
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

export function records(
  exec: SqlExecutor,
  tenantId: string,
  input: { source: string; entity: string; limit: number; cursor?: string | null },
): Promise<Page<RawRecord>> {
  return listRecords(
    exec,
    tenantId,
    { source: input.source, entity: input.entity },
    { limit: input.limit, cursor: input.cursor ?? null },
  );
}

export function documents(
  exec: SqlExecutor,
  tenantId: string,
  input: { source: string; limit: number; cursor?: string | null },
): Promise<Page<RawDocument>> {
  return listDocuments(exec, tenantId, input.source, {
    limit: input.limit,
    cursor: input.cursor ?? null,
  });
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
