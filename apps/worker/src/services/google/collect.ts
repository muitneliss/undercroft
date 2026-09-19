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
import { landDocuments } from "../landDocument.ts";
import { loadStreamToRaw } from "../loadToRaw.ts";
import type { GoogleApi } from "./api.ts";
import { harvestDrive } from "./drive.ts";
import { harvestGmail } from "./gmail.ts";

export const GOOGLE_SOURCES = ["gmail", "drive"] as const;
export type GoogleSource = (typeof GOOGLE_SOURCES)[number];

export function isGoogleSource(source: string): source is GoogleSource {
  return (GOOGLE_SOURCES as readonly string[]).includes(source);
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

export async function runGoogleCollect(
  deps: CollectDeps,
  input: { source: GoogleSource; tenantId: string },
): Promise<CollectResult> {
  const runId = newRunId();
  const observedAt = (deps.now ?? (() => new Date()))().toISOString();

  const detail = await readConnectionDetail(deps.exec, input.tenantId, input.source);
  const scope = detail === null ? null : parseScope(input.source, detail.selectionJson);
  if (scope === null) {
    throw new ScopeNotChosen(input.source, input.tenantId);
  }

  const harvest =
    scope.kind === "gmail"
      ? { ...(await harvestGmail(deps.api, scope)), seenIds: null }
      : await harvestDrive(deps.api, scope);

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

  // Catalogue only what actually reached the lake. A skipped or failed document has no
  // bytes to point at, and a row claiming otherwise is worse than no row.
  const rows: RawDocumentRow[] = [];
  for (const result of landedDocuments.results) {
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
      observedAt,
      runId,
    });
  }
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
