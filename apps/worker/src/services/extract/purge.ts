/**
 * A document's bytes leave the lake once extraction has had its go at them. ADR 0161.
 *
 * THE OWNER'S DECISION, NOT AN OPTIMISATION. Every document this platform reads is a file in the
 * customer's own Drive or mailbox. Once the extract pass has ATTEMPTED it -- read it, or refused
 * it with a reason -- and the passes that need its bytes again are done (a workbook's rows, an
 * archive's members), its bytes are deleted and the catalogue row keeps its name, its link at the
 * source, its times and the purge record. A failed read is purged too; its reason, type, size,
 * digest and reader generation stay in `raw.document_text` and `raw.documents`. No copy is kept.
 *
 * WHAT THIS COSTS, accepted by the owner and written in the ADR: a purged document cannot be read
 * again -- no newer reader, no rows generation, no archive opened twice -- so its text in
 * `raw.document_text` is now the only reading there will ever be, not a projection to rebuild.
 *
 * Three things compose here and must not know about each other: Postgres decides which digests no
 * holder still needs (`repos/documentPurge.ts`), the lake deletes them and reports it first
 * (`LakeStore.purgeBlobs`, the one writer), and Postgres records the outcome on every document.
 * In that order: deleted and then recorded, so a purge cut off between the two leaves documents
 * unmarked whose blob is gone, and the next purge finds them again and records them `absent`. The
 * other order would mark documents purged whose bytes were still there -- a record that says the
 * owner's decision was carried out when it was not.
 *
 * BOUNDED PER CALL AND REPORTED (`raw-lake.md`): at most `limit` digests, a report in the lake
 * naming each before anything is deleted, a mark on each document, and counts back to the caller
 * for the run's journal.
 */

import type { SqlExecutor } from "@undercroft/db";
import type { LakeStore } from "@undercroft/lake";

import {
  type DigestOutcome,
  type PurgeScope,
  purgeableDigests,
  recordPurge,
  type Settlement,
} from "../../repos/documentPurge.ts";
import { CURRENT_READER_VERSION } from "./extractText.ts";
import { CURRENT_ROWS_VERSION, TABULAR_TYPES, WORKBOOK_METHODS } from "./workbookRows.ts";

/** Digests one extract pass purges, at most: a delete each, cheap beside a read. */
export const PURGE_PER_PASS = 1000;

/**
 * The generations a purge waits for: every backlog that would read a document's bytes again. The
 * same constants the pass reads with, so the purge can never get ahead of a reader it ships with.
 */
export const CURRENT_SETTLEMENT: Settlement = {
  readerVersion: CURRENT_READER_VERSION,
  workbookMethods: WORKBOOK_METHODS,
  rowsVersion: CURRENT_ROWS_VERSION,
  tabularTypes: TABULAR_TYPES,
};

/** What one purge did. */
export interface Purged {
  /** Digests removed from the lake, or found already gone. */
  readonly digests: number;
  /** Documents marked purged -- every settled holder of those digests, in any tenant. */
  readonly documents: number;
  /** Bytes deleted, once per digest: what left the object store, not a sum over documents. */
  readonly bytes: number;
  /** Digests whose blob was already gone when the purge came for it. */
  readonly absent: number;
  /** The lake report naming every digest, written before the deletes; `null` when none. */
  readonly report: string | null;
}

/** A purge that removed nothing. */
export const NOTHING_PURGED: Purged = {
  digests: 0,
  documents: 0,
  bytes: 0,
  absent: 0,
  report: null,
};

/**
 * Purge up to `limit` digests held by `scope` whose every holder is settled.
 *
 * `by` is what the lake report says did it -- a run, or an operator's command -- because the
 * report outlives the run that wrote it.
 */
export async function purgeSettled(
  deps: { readonly exec: SqlExecutor; readonly lake: LakeStore },
  scope: PurgeScope,
  request: {
    readonly limit: number;
    readonly purgedAt: string;
    readonly by: Readonly<Record<string, unknown>>;
  },
): Promise<Purged> {
  const digests = await purgeableDigests(deps.exec, scope, {
    ...CURRENT_SETTLEMENT,
    limit: request.limit,
  });
  if (digests.length === 0) {
    return NOTHING_PURGED;
  }

  const purge = await deps.lake.purgeBlobs(
    digests.map((digest) => digest.sha256),
    { ...request.by, scope },
  );
  const outcomes: DigestOutcome[] = [
    ...purge.deleted.map((sha256) => ({ sha256, outcome: "deleted" as const })),
    ...purge.absent.map((sha256) => ({ sha256, outcome: "absent" as const })),
  ];
  const documents = await recordPurge(deps.exec, outcomes, {
    ...CURRENT_SETTLEMENT,
    purgedAt: request.purgedAt,
    report: purge.report,
  });

  const deleted = new Set(purge.deleted);
  // A byte count is an integer index, not an amount: `parseInt` is the spelling `money.md`
  // leaves alone, and 2^53 bytes is eight petabytes.
  const bytes = digests
    .filter((digest) => deleted.has(digest.sha256))
    .reduce((sum, digest) => sum + Number.parseInt(digest.byteLength, 10), 0);

  return {
    digests: digests.length,
    documents,
    bytes,
    absent: purge.absent.length,
    report: purge.report,
  };
}
