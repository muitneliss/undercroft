/**
 * The one-off for documents landed before ADR 0161: trace them, say what is still unread, and
 * purge every digest nothing needs. A dry run unless told to apply.
 *
 * Going forward the extract pass purges what it settles (`extract/purge.ts`) and a landing
 * writes a document's name and link itself. What this adds is the backlog the day it ships --
 * ~196k documents whose bytes are all still held, and whose names are only in lake manifests --
 * done at once by a person who reads the dry run first, rather than 1,000 digests an hour.
 *
 * THREE STEPS, EACH SAFE TO RUN AGAIN:
 *
 * 1. **Trace.** A document with neither a name nor a link gets them: the name from the manifest
 *    of the observation that holds its current bytes (`filename`, which every landing has
 *    written), the link derived from its id (`google/sourceLinks.ts`), an archive member's link
 *    copied from its archive. Manifests are kept by a purge, so this works before or after one.
 *    Only Drive and Gmail have a rule; a HubSpot note has no name and no link that can be
 *    derived, and is counted as untraceable rather than guessed at.
 * 2. **Report what is unread.** This does not extract. A document the extract pass has not
 *    attempted keeps its bytes and is reported by why (`purgeOutlook`); the hourly scheduler
 *    reads it, and running this again then purges it. Extracting here would run poppler and
 *    tesseract on the operator's machine, whose versions are not the worker's -- a reading the
 *    pipeline did not make, stamped as if it had.
 * 3. **Purge.** Every digest no holder in any tenant still needs, in batches, through the same
 *    `purgeSettled` the pass uses: reported to the lake before each batch is deleted, and recorded
 *    on every document after.
 *
 * WHAT A DRY RUN READS: counts, from Postgres alone. Not a single manifest -- tracing 196k
 * documents is ~400k requests, which is the apply's cost and not the look's.
 */

import { sourceKind } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import type { LakeStore } from "@undercroft/lake";

import { type PurgeOutlook, purgeOutlook } from "../repos/documentPurge.ts";
import {
  linkMembersToArchives,
  type Trace,
  type UntracedDocument,
  type UntracedScope,
  untracedDocuments,
  untracedScopes,
  writeTraces,
} from "../repos/documentTrace.ts";
import { CURRENT_SETTLEMENT, type Purged, purgeSettled } from "./extract/purge.ts";
import { driveFileLink, gmailMessageLink } from "./google/sourceLinks.ts";
import { inTurns } from "./lakeCompaction.ts";

/** Digests one purge batch removes: one lake report each, a few seconds over a tunnel. */
export const PURGE_BATCH = 2000;

/** Manifests read at once: round trips in flight, as compaction's. */
export const DEFAULT_CONCURRENCY = 16;

const TRACE_PAGE = 500;

/** The source kinds whose documents have a name and a link to derive. */
const TRACEABLE_KINDS: ReadonlySet<string> = new Set(["drive", "gmail"]);

export interface PurgeOperatorDeps {
  readonly exec: SqlExecutor;
  readonly lake: LakeStore;
  readonly now?: () => Date;
  readonly concurrency?: number;
  /** One line per finished step, for a person watching a long apply. */
  readonly progress?: (line: Record<string, unknown>) => void;
}

export interface PurgeRequest {
  /** `false` reports and changes nothing. */
  readonly apply: boolean;
  /** One tenant's documents, or every tenant's when `null`. */
  readonly tenantId: string | null;
}

/** What tracing one (tenant, source) did, or in a dry run would try. */
export interface ScopeTrace extends UntracedScope {
  /** Whether this source's kind has a rule; an untraceable scope is counted and left alone. */
  readonly traceable: boolean;
  /** Rows given a name or a link. Zero in a dry run. */
  readonly traced: number;
  /** Archive members given their archive's link. Zero in a dry run. */
  readonly membersLinked: number;
}

export interface PurgeOperatorOutcome {
  readonly apply: boolean;
  readonly traces: readonly ScopeTrace[];
  /** Summed over every batch; all zero in a dry run. */
  readonly purged: Purged & { readonly reports: readonly string[] };
  /** Per tenant: before anything was done in a dry run, after the purge in an apply. */
  readonly outlook: readonly PurgeOutlook[];
}

/** The observation at `key` that holds `sha256`, newest first: where its name was written. */
async function manifestHolding(
  lake: LakeStore,
  key: string,
  sha256: string,
): Promise<Record<string, unknown> | null> {
  for (const stamp of (await lake.versions(key)).toReversed()) {
    const manifest = await lake.manifest(key, stamp);
    if (manifest.sha256 === sha256) {
      return manifest;
    }
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The trace of one document. The name only from a manifest that names these bytes; the link
 * from the id by the same rule a landing uses; a member's link later, from its archive's row.
 */
async function traceOf(lake: LakeStore, kind: string, row: UntracedDocument): Promise<Trace> {
  const member = text(row.metadata.archiveDocumentId) !== null;
  // A mail's body has no name, so its manifest is not worth the two requests.
  const named = row.metadata.part !== "body";
  const manifest = named ? await manifestHolding(lake, row.lakeKey, row.sha256) : null;
  let sourceUrl: string | null = null;
  if (!member && kind === "drive") {
    sourceUrl = driveFileLink(row.documentId);
  } else if (!member && kind === "gmail") {
    const messageId = text(row.metadata.messageId);
    sourceUrl = messageId === null ? null : gmailMessageLink(messageId);
  }
  return {
    documentId: row.documentId,
    sha256: row.sha256,
    fileName: text(manifest?.filename),
    sourceUrl,
  };
}

/** Trace one scope's untraced documents, a page at a time, keyset by id. */
async function traceScope(deps: PurgeOperatorDeps, scope: UntracedScope): Promise<ScopeTrace> {
  const kind = sourceKind(scope.source);
  let traced = 0;
  let after: string | null = null;
  for (;;) {
    const page = await untracedDocuments(deps.exec, scope, { after, limit: TRACE_PAGE });
    if (page.length === 0) {
      break;
    }
    const traces = await inTurns(page, deps.concurrency ?? DEFAULT_CONCURRENCY, (row) =>
      traceOf(deps.lake, kind, row),
    );
    traced += await writeTraces(deps.exec, scope, traces);
    after = page.at(-1)?.documentId ?? null;
  }
  const membersLinked = await linkMembersToArchives(deps.exec, scope);
  return { ...scope, traceable: true, traced, membersLinked };
}

async function traceAll(deps: PurgeOperatorDeps, request: PurgeRequest): Promise<ScopeTrace[]> {
  const traces: ScopeTrace[] = [];
  for (const scope of await untracedScopes(deps.exec, request.tenantId)) {
    const traceable = TRACEABLE_KINDS.has(sourceKind(scope.source));
    const trace =
      traceable && request.apply
        ? await traceScope(deps, scope)
        : { ...scope, traceable, traced: 0, membersLinked: 0 };
    deps.progress?.({ step: "trace", ...trace });
    traces.push(trace);
  }
  return traces;
}

/** Purge batch after batch until nothing settled is left in scope. */
async function purgeAll(
  deps: PurgeOperatorDeps,
  request: PurgeRequest,
): Promise<PurgeOperatorOutcome["purged"]> {
  const total = { digests: 0, documents: 0, bytes: 0, absent: 0 };
  const reports: string[] = [];
  const now = deps.now ?? ((): Date => new Date());
  for (;;) {
    const batch = await purgeSettled(
      deps,
      { tenantId: request.tenantId, source: null },
      { limit: PURGE_BATCH, purgedAt: now().toISOString(), by: { operator: "db:document-purge" } },
    );
    if (batch.report === null) {
      break;
    }
    total.digests += batch.digests;
    total.documents += batch.documents;
    total.bytes += batch.bytes;
    total.absent += batch.absent;
    reports.push(batch.report);
    deps.progress?.({ step: "purge", ...batch });
    if (batch.documents === 0) {
      // Every holder of the batch turned unsettled between the question and the mark -- a
      // landing raced it. Asked again, the same digests would not be offered, but stopping is
      // the bound that does not rest on that: the next run picks up whatever is left.
      break;
    }
  }
  return { ...total, report: reports.at(-1) ?? null, reports };
}

const NOTHING_PURGED: PurgeOperatorOutcome["purged"] = {
  digests: 0,
  documents: 0,
  bytes: 0,
  absent: 0,
  report: null,
  reports: [],
};

export async function purgeDocumentBytes(
  deps: PurgeOperatorDeps,
  request: PurgeRequest,
): Promise<PurgeOperatorOutcome> {
  const traces = await traceAll(deps, request);
  const purged = request.apply ? await purgeAll(deps, request) : NOTHING_PURGED;
  const outlook = await purgeOutlook(deps.exec, request.tenantId, CURRENT_SETTLEMENT);
  return { apply: request.apply, traces, purged, outlook };
}
