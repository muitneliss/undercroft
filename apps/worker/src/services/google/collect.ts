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

// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Same functions as noExcessiveLinesPerFunction: one sequential procedure each, whose branches are the states the thing being driven can actually be in.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/style/noContinue: Each `continue` here skips one item in a loop with a stated reason on the line above. Restructuring to avoid it means nesting the body in an `if`, which adds a level of indentation and says nothing new.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.

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

export async function runGoogleCollect(
  deps: CollectDeps,
  input: { source: GoogleSource; tenantId: string; runId?: string },
): Promise<CollectResult> {
  // The caller that opened an `ops.run` row hands its id down; a caller with no ledger
  // still gets a run id on every object it lands.
  const runId = input.runId ?? newRunId();
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
