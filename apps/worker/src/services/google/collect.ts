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
import { readConnectionDetail } from "@undercroft/db/repos";
import type { LakeStore } from "@undercroft/lake";

import {
  upsertDocuments,
  type RawDocumentRow,
  tombstoneMissing,
} from "../../repos/rawDocuments.ts";
import { landRecords } from "../land.ts";
import { type DocumentToLand, landDocuments, type LandedDocument } from "../landDocument.ts";
import { loadStreamToRaw } from "../loadToRaw.ts";
import type { GoogleApi } from "./api.ts";
import { harvestDrive } from "./drive.ts";
import { type GmailHarvest, harvestGmail } from "./gmail.ts";

export const GOOGLE_SOURCES = ["gmail", "drive"] as const;
export type GoogleSource = (typeof GOOGLE_SOURCES)[number];

/** Widened once, so the membership test needs neither an assertion nor a linear scan. */
const GOOGLE_SOURCE_NAMES: ReadonlySet<string> = new Set(GOOGLE_SOURCES);

export function isGoogleSource(source: string): source is GoogleSource {
  return GOOGLE_SOURCE_NAMES.has(source);
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
}

export interface CollectResult {
  readonly runId: string;
  readonly source: string;
  readonly records: { landed: number; loadedCreated: number; loadedChanged: number };
  readonly documents: {
    created: number;
    unchanged: number;
    skipped: number;
    failed: number;
    tombstoned: number;
  };
}

/**
 * Catalogue rows for the documents that actually reached the lake.
 *
 * A skipped or failed document has no bytes to point at, and a row claiming otherwise is
 * worse than no row -- so a result that is neither `created` nor `unchanged` produces none,
 * and neither does one whose source document cannot be found to read its metadata from.
 *
 * `metadata`, never `manifest`: this row reaches `raw.documents`, which is granted to
 * `undercroft_dbt`. See `.claude/rules/pii.md` and ADR 0015.
 */
function catalogueRows(
  landed: readonly LandedDocument[],
  documents: readonly DocumentToLand[],
  stamp: { observedAt: string; runId: string },
): RawDocumentRow[] {
  const rows: RawDocumentRow[] = [];
  for (const result of landed) {
    if (result.status !== "created" && result.status !== "unchanged") {
      continue;
    }
    const source = documents.find((d) => d.documentId === result.documentId);
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
 * The scope an admin recorded, or a refusal.
 *
 * A run never invents one. "Nobody has chosen yet" and "somebody chose everything" are
 * different facts, and collapsing the first into the second reads a whole mailbox on an
 * authority nobody granted.
 */
async function requireScope(
  deps: CollectDeps,
  input: { source: GoogleSource; tenantId: string },
): Promise<NonNullable<ReturnType<typeof parseScope>>> {
  const detail = await readConnectionDetail(deps.exec, input.tenantId, input.source);
  const scope = detail === null ? null : parseScope(input.source, detail.selectionJson);
  if (scope === null) {
    throw new ScopeNotChosen(input.source, input.tenantId);
  }
  return scope;
}

/**
 * Harvest under the chosen scope.
 *
 * `seenIds` is Drive's alone and null for Gmail, deliberately: a message that stops matching
 * a label selection has been relabelled, not deleted, and the tombstone pass must not be
 * handed a set that would report a deletion which never happened.
 */
async function harvestFor(
  api: GoogleApi,
  scope: NonNullable<ReturnType<typeof parseScope>>,
): Promise<GmailHarvest & { seenIds: readonly string[] | null }> {
  return scope.kind === "gmail"
    ? { ...(await harvestGmail(api, scope)), seenIds: null }
    : await harvestDrive(api, scope);
}

export async function runGoogleCollect(
  deps: CollectDeps,
  input: { source: GoogleSource; tenantId: string },
): Promise<CollectResult> {
  const runId = newRunId();
  const observedAt = (deps.now ?? ((): Date => new Date()))().toISOString();

  const scope = await requireScope(deps, input);

  const harvest = await harvestFor(deps.api, scope);

  const entity = scope.kind === "gmail" ? "messages" : "files";

  const landedRecords = await landRecords(deps.lake, {
    source: input.source,
    tenantId: input.tenantId,
    runId,
    records: harvest.records,
  });
  const loaded = await loadStreamToRaw(deps.exec, deps.lake, {
    source: input.source,
    tenantId: input.tenantId,
    entity,
  });

  const landedDocuments = await landDocuments(deps.lake, {
    source: input.source,
    tenantId: input.tenantId,
    runId,
    documents: harvest.documents,
  });

  const rows = catalogueRows(landedDocuments.results, harvest.documents, { observedAt, runId });
  await upsertDocuments(deps.exec, { source: input.source, tenantId: input.tenantId }, rows);

  // Drive only. A Gmail message that stops matching a label selection has been relabelled,
  // not deleted, and tombstoning it would report a deletion that never happened.
  const tombstoned =
    harvest.seenIds === null
      ? 0
      : await tombstoneMissing(
          deps.exec,
          { source: input.source, tenantId: input.tenantId },
          { keptIds: harvest.seenIds, observedAt },
        );

  return {
    runId,
    source: input.source,
    records: {
      landed: landedRecords.created + landedRecords.unchanged,
      loadedCreated: loaded.created,
      loadedChanged: loaded.changed,
    },
    documents: {
      created: landedDocuments.created,
      unchanged: landedDocuments.unchanged,
      skipped: landedDocuments.skipped,
      failed: landedDocuments.failed,
      tombstoned,
    },
  };
}
