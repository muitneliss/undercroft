/**
 * What an extract pass did, counted in documents: the numbers a run reports, the refusals its
 * ledger holds, and those refusals by reason. Split from `runExtract.ts`, which does the pass;
 * this only counts it.
 */

import type { RunReasonCount, RunRefusal } from "@undercroft/db/repos";

import type { AnsweredDocuments, DocumentTextRow } from "../../repos/documentText.ts";
import type { MembersLanded } from "./archiveMembers.ts";

/** The entity every extract refusal is recorded against; this verb reads exactly one kind. */
export const DOCUMENTS = "documents";

/**
 * Every read that produced no text, as a ledger row -- one per DISTINCT DIGEST.
 *
 * The fan-out is deliberately not expanded here. `upsertDocumentText` answers every document
 * holding those bytes and reports how many, but it does not hand back their ids, and inventing
 * a row per document would mean writing 245 ledger entries that say one thing about one file.
 * So the list is the distinct files and the COUNT beside it is the documents; the interface
 * captions it as files for that reason.
 */
function refusalsOf(rows: readonly DocumentTextRow[]): RunRefusal[] {
  return rows
    .filter((row) => row.method === null && row.reason !== null)
    .map((row) => ({
      entity: DOCUMENTS,
      sourceRecordId: row.documentId,
      // Narrowed by the filter; `reason` is non-null exactly when `method` is null, which the
      // `document_text_said_why` CHECK guarantees on the way into Postgres too.
      reason: row.reason ?? "",
    }));
}

/**
 * Count the reasons, biggest first -- the order a reader wants them in.
 *
 * WEIGHTED BY THE FAN-OUT, like `tally` and for the same reason: these counts are what a reader
 * presses into after reading "245 refused", so they have to add up to 245 rather than to the
 * number of distinct files behind it.
 *
 * A `Map` rather than an object literal for the reason the `READERS` table is one: the key is
 * a reason string, and a lookup of `constructor` in a plain object answers with something that
 * is not a count.
 */
function tallyReasons(
  rows: readonly DocumentTextRow[],
  answered: AnsweredDocuments,
  members: MembersLanded,
): RunReasonCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.method === null && row.reason !== null) {
      const documents = answered.get(row.documentId) ?? 0;
      counts.set(row.reason, (counts.get(row.reason) ?? 0) + documents);
    }
  }
  // A member refusal is already one per document: it is filed against each holder's member.
  for (const refusal of members.refusals) {
    counts.set(refusal.reason, (counts.get(refusal.reason) ?? 0) + 1);
  }
  return [...counts]
    .map(([reason, count]) => ({ entity: DOCUMENTS, reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/**
 * The catalogue says the bytes are there and the lake disagrees.
 *
 * Recorded against the document rather than raised, so one unreadable object does not end a
 * pass over the other 499 -- and counted apart from a refusal, because "we could not fetch
 * it" is a fact about the store while "we could not read it" is a fact about the document.
 */
export const LAKE_UNREADABLE = "lake-object-unreadable";

/**
 * What the pass did, in documents rather than in reads.
 *
 * Each read is weighted by how many catalogue rows it answered, so `read` keeps meaning
 * "documents that left with a method" -- the thing `job.ts` records as the run's `created` and a
 * customer sees on the run. Counting reads instead would quietly halve that number the day the
 * fan-out landed, for a pass that did strictly more.
 */
function tally(
  rows: readonly DocumentTextRow[],
  answered: AnsweredDocuments,
): { read: number; refused: number; unreadable: number } {
  let read = 0;
  let refused = 0;
  let unreadable = 0;
  for (const row of rows) {
    const documents = answered.get(row.documentId) ?? 0;
    if (row.reason === LAKE_UNREADABLE) {
      unreadable += documents;
    } else if (row.method === null) {
      refused += documents;
    } else {
      read += documents;
    }
  }
  return { read, refused, unreadable };
}

/**
 * What a pass did, in documents, whole: its counts, its refusals for the ledger, and those
 * refusals counted by reason. A member of an archive that did not land is a refused document
 * like any other (ADR 0108), so it is in all three -- `reasonCounts` keeps summing to `refused`.
 */
export function passCounts(
  rows: readonly DocumentTextRow[],
  answered: AnsweredDocuments,
  members: MembersLanded,
): {
  read: number;
  refused: number;
  unreadable: number;
  refusals: RunRefusal[];
  reasonCounts: RunReasonCount[];
} {
  const { read, refused, unreadable } = tally(rows, answered);
  return {
    read,
    refused: refused + members.refusals.length,
    unreadable,
    refusals: [...refusalsOf(rows), ...members.refusals],
    reasonCounts: tallyReasons(rows, answered, members),
  };
}
