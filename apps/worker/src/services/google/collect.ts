/**
 * One Google source, collected for one tenant.
 *
 * The same vertical slice `runIngest` drives for a YAML connector -- resolve a token, read
 * the source, land into the lake, project into Postgres -- with the two steps a spec cannot
 * express: bytes, and a per-tenant scope that decides what may be read at all.
 *
 * A scope is REQUIRED. A connection with no recorded selection is refused rather than
 * defaulted, because the two readings of an absent scope are "nobody has chosen yet" and
 * "somebody chose everything", and guessing the second reads a customer's whole mailbox on
 * the strength of a missing row. The UI has a `needs_scope` state for exactly this.
 */

import { parseScope } from "@undercroft/contracts";
import { newRunId } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { readConnectionDetail, type RunRefusal } from "@undercroft/db/repos";
import type { LakeStore } from "@undercroft/lake";

import {
  upsertDocuments,
  type RawDocumentRow,
  tombstoneMissing,
} from "../../repos/rawDocuments.ts";
import { landRecords } from "../land.ts";
import { landDocuments } from "../landDocument.ts";
import { loadStreamToRaw } from "../loadToRaw.ts";
import { type RunJournal, SILENT_JOURNAL } from "../runJournal.ts";
import type { GoogleApi } from "./api.ts";
import { harvestDrive } from "./drive.ts";
import { harvestGmail } from "./gmail.ts";

export const GOOGLE_SOURCES = ["gmail", "drive"] as const;
export type GoogleSource = (typeof GOOGLE_SOURCES)[number];

const GOOGLE_SOURCE_SET: ReadonlySet<string> = new Set<string>(GOOGLE_SOURCES);

export function isGoogleSource(source: string): source is GoogleSource {
  return GOOGLE_SOURCE_SET.has(source);
}

export class ScopeNotChosen extends Error {
  constructor(source: string, tenantId: string) {
    super(
      `${source} for tenant ${JSON.stringify(tenantId)} has no recorded scope; ` +
        "an admin must choose what to share before a run can read anything",
    );
    this.name = "ScopeNotChosen";
  }
}

export interface CollectDeps {
  readonly lake: LakeStore;
  readonly exec: SqlExecutor;
  readonly api: GoogleApi;
  readonly now?: () => Date;
  /** Where this collection narrates itself. Absent means a caller with no run to narrate. */
  readonly journal?: RunJournal;
}

export interface CollectResult {
  readonly runId: string;
  readonly source: string;
  readonly records: {
    landed: number;
    loadedCreated: number;
    loadedChanged: number;
    loadedUnchanged: number;
  };
  readonly documents: {
    created: number;
    unchanged: number;
    skipped: number;
    failed: number;
    tombstoned: number;
  };
  /**
   * What this run refused, with why: a record that could not be landed under entity
   * `messages`/`files`, a document skipped over the size ceiling or failed under
   * `documents`. The ids are opaque provider ids, never a subject or a filename.
   */
  readonly refusals: RunRefusal[];
}

/**
 * What a harvest answers with, whichever of the two collectors ran.
 *
 * `seenIds` is Drive's alone and null for Gmail, deliberately: a message that stops matching
 * a label selection has been relabelled, not deleted, and the tombstone pass must not be
 * handed a set that would report a deletion which never happened.
 */
type Harvest = Omit<Awaited<ReturnType<typeof harvestDrive>>, "seenIds"> & {
  readonly seenIds: readonly string[] | null;
};

/** What `landDocuments` answered, which the catalogue and the refusals both read. */
type LandedDocuments = Awaited<ReturnType<typeof landDocuments>>;

/**
 * The scope an admin chose, or a refusal.
 *
 * A Google source parses to a Google scope or to nothing; the third shape belongs to another
 * collector and would mean a row written under the wrong source.
 */
async function googleScope(
  deps: CollectDeps,
  input: { source: GoogleSource; tenantId: string },
): Promise<Exclude<NonNullable<ReturnType<typeof parseScope>>, { kind: "xero" }>> {
  const detail = await readConnectionDetail(deps.exec, input.tenantId, input.source);
  const scope = detail === null ? null : parseScope(input.source, detail.selectionJson);
  if (scope === null || scope.kind === "xero") {
    throw new ScopeNotChosen(input.source, input.tenantId);
  }
  return scope;
}

/**
 * The rows `raw.documents` gets: only what actually reached the lake.
 *
 * A skipped or failed document has no bytes to point at, and a row claiming otherwise is
 * worse than no row. Nothing a human wrote goes in `metadata` -- `pii.md`, ADR 0015.
 */
function catalogueRows(
  harvest: Harvest,
  landed: LandedDocuments,
  stamp: { observedAt: string; runId: string },
): RawDocumentRow[] {
  const rows: RawDocumentRow[] = [];
  for (const result of landed.results) {
    if (result.status !== "created" && result.status !== "unchanged") {
      continue;
    }
    const source = harvest.documents.find((d) => d.documentId === result.documentId);
    if (source === undefined) {
      continue;
    }
    rows.push({
      documentId: result.documentId,
      lakeKey: result.lakeKey ?? "",
      sha256: result.sha256 ?? "",
      byteLength: result.byteLength ?? "0",
      contentType: source.contentType,
      metadataJson: JSON.stringify({
        ...source.metadata,
        sourceUpdatedAt: source.sourceUpdatedAt,
      }),
      observedAt: stamp.observedAt,
      runId: stamp.runId,
    });
  }
  return rows;
}

/**
 * What this run refused, with why.
 *
 * Recorded rather than dropped: a record that could not be keyed, a document over the size
 * ceiling, a pick the harvest would not take. Every id is the provider's opaque one, never a
 * subject or a filename.
 */
function refusalsFor(
  entity: string,
  harvest: Harvest,
  landedRecords: Awaited<ReturnType<typeof landRecords>>,
  landedDocuments: LandedDocuments,
): RunRefusal[] {
  const refusals: RunRefusal[] = [];
  for (const result of landedRecords.results) {
    if (result.status === "failed") {
      refusals.push({
        entity,
        sourceRecordId: result.sourceRecordId,
        reason: result.reason ?? "refused",
      });
    }
  }
  for (const result of landedDocuments.results) {
    if (result.status === "skipped" || result.status === "failed") {
      refusals.push({
        entity: "documents",
        sourceRecordId: result.documentId,
        reason: result.reason ?? result.status,
      });
    }
  }
  for (const pick of harvest.skipped) {
    refusals.push({ entity, sourceRecordId: pick.fileId, reason: pick.reason });
  }
  return refusals;
}

/** Where and when one harvest is landed: the lake first, then its projection in Postgres. */
interface Landing {
  readonly source: GoogleSource;
  readonly tenantId: string;
  readonly runId: string;
  readonly entity: string;
  readonly observedAt: string;
}

/**
 * Land the harvest: records to the lake and on into `raw.records`, documents to the lake.
 *
 * The lake write is first and is create-only; everything in Postgres after it is a
 * projection that may be dropped and rebuilt. `raw-lake.md`.
 */
async function landHarvest(
  deps: CollectDeps,
  at: Landing,
  harvest: Harvest,
): Promise<{
  landedRecords: Awaited<ReturnType<typeof landRecords>>;
  loaded: Awaited<ReturnType<typeof loadStreamToRaw>>;
  landedDocuments: LandedDocuments;
}> {
  const landedRecords = await landRecords(deps.lake, {
    source: at.source,
    tenantId: at.tenantId,
    runId: at.runId,
    records: harvest.records,
  });
  const loaded = await loadStreamToRaw(deps.exec, deps.lake, {
    source: at.source,
    tenantId: at.tenantId,
    entity: at.entity,
  });
  const landedDocuments = await landDocuments(deps.lake, {
    source: at.source,
    tenantId: at.tenantId,
    runId: at.runId,
    documents: harvest.documents,
  });
  return { landedRecords, loaded, landedDocuments };
}

/**
 * The Postgres projection of the documents: the catalogue, then the tombstones.
 *
 * Tombstoning is DRIVE'S ALONE and skipped when `seenIds` is null. A Gmail message that stops
 * matching a label selection has been relabelled, not deleted, and a tombstone would report a
 * deletion that never happened.
 */
async function projectDocuments(
  deps: CollectDeps,
  at: Landing,
  harvest: Harvest,
  landed: LandedDocuments,
): Promise<number> {
  const scoped = { source: at.source, tenantId: at.tenantId };
  await upsertDocuments(
    deps.exec,
    scoped,
    catalogueRows(harvest, landed, { observedAt: at.observedAt, runId: at.runId }),
  );
  if (harvest.seenIds === null) {
    return 0;
  }
  return await tombstoneMissing(deps.exec, scoped, {
    keptIds: harvest.seenIds,
    observedAt: at.observedAt,
  });
}

export async function runGoogleCollect(
  deps: CollectDeps,
  input: { source: GoogleSource; tenantId: string; runId?: string },
): Promise<CollectResult> {
  // The caller that opened an `ops.run` row hands its id down; a caller with no ledger
  // still gets a run id on every object it lands.
  const runId = input.runId ?? newRunId();
  const observedAt = (deps.now ?? ((): Date => new Date()))().toISOString();
  const scope = await googleScope(deps, input);
  const entity = scope.kind === "gmail" ? "messages" : "files";

  const journal = deps.journal ?? SILENT_JOURNAL;
  journal.info("entity_started", { entity });

  const harvest: Harvest =
    scope.kind === "gmail"
      ? { ...(await harvestGmail(deps.api, scope, journal)), seenIds: null, skipped: [] }
      : await harvestDrive(deps.api, scope, journal);

  const at: Landing = {
    source: input.source,
    tenantId: input.tenantId,
    runId,
    entity,
    observedAt,
  };
  const { landedRecords, loaded, landedDocuments } = await landHarvest(deps, at, harvest);
  const tombstoned = await projectDocuments(deps, at, harvest, landedDocuments);

  const refusals = refusalsFor(entity, harvest, landedRecords, landedDocuments);

  journal.info("documents_landed", {
    entity: "documents",
    created: landedDocuments.created,
    unchanged: landedDocuments.unchanged,
    skipped: landedDocuments.skipped,
    failed: landedDocuments.failed,
    tombstoned,
  });

  return {
    runId,
    source: input.source,
    records: {
      landed: landedRecords.created + landedRecords.unchanged,
      loadedCreated: loaded.created,
      loadedChanged: loaded.changed,
      loadedUnchanged: loaded.unchanged,
    },
    refusals,
    documents: {
      created: landedDocuments.created,
      unchanged: landedDocuments.unchanged,
      skipped: landedDocuments.skipped,
      failed: landedDocuments.failed,
      tombstoned,
    },
  };
}
