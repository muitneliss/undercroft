/**
 * Landing records into the raw lake.
 *
 * One writer, many callers: the connector runtime lands here, and so does the lake REST
 * API when an external script pushes records. Both go through this function, so the
 * create-only and content-addressing guarantees hold whatever called it.
 *
 * The payload stored is the record's canonical text as bytes. Content addressing is over
 * those bytes, so re-landing an unchanged record reports `unchanged` and writes nothing.
 *
 * ## This is where a run's New / Changed / Unchanged are decided
 *
 * Each record that reaches the lake is exactly one of three things, and the lake's own write
 * is what tells them apart: `created` is the key's first observation, `changed` is a new
 * version of a key the lake already held, and `unchanged` is bytes identical to the newest
 * observation, so nothing was written. `landed` is their sum by construction, and a refusal
 * (`failed`) is none of them.
 *
 * The split used to be taken from the projection into `raw.records` instead, and that
 * measured something else: the journal entries the pass happened to read. An identical
 * record writes no journal entry, so it never reached the projection and was counted
 * nowhere -- the run said Landed 3, Changed 2, Unchanged 0 (issue #284) -- and a pass that
 * swept up what an earlier, killed run had left unprojected counted THAT run's records as
 * this one's. Counted here, the three are this run's records and nothing else, whatever the
 * projection does afterwards.
 */

import { type LandRecordsResponse, lakeKeyOf, streamOf } from "@undercroft/contracts";
import type { LakeStore, PutResult } from "@undercroft/lake";

export interface RecordToLand {
  readonly entity: string;
  readonly sourceRecordId: string;
  readonly sourceUpdatedAt: string | null;
  readonly payloadText: string;
}

/** What became of one record. See the module docstring for what the three landed ones mean. */
export type LandStatus = "created" | "changed" | "unchanged" | "failed";

export interface LandedRecord {
  readonly entity: string;
  readonly sourceRecordId: string;
  readonly status: LandStatus;
  readonly sha256?: string;
  readonly lakeKey?: string;
  readonly stamp?: string;
  readonly reason?: string;
}

export interface LandResult {
  readonly created: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly failed: number;
  readonly results: LandedRecord[];
}

const encoder = new TextEncoder();

/** A put's outcome as the record's: its first observation, a new version, or the same bytes. */
function statusOf(put: PutResult): Exclude<LandStatus, "failed"> {
  if (put.status === "unchanged") {
    return "unchanged";
  }
  return put.previousSha256 === null ? "created" : "changed";
}

/**
 * Land a batch of records for one (source, tenant).
 *
 * Each record is landed independently; a single bad record is reported as `failed`
 * rather than aborting the batch, and the caller decides what a failure in the batch
 * means (the REST API turns any failure into a 422). Nothing is a float, nothing is
 * guessed: a record that cannot be keyed is a failure with a reason, not a silent drop.
 */
export async function landRecords(
  lake: LakeStore,
  input: {
    source: string;
    tenantId: string;
    runId: string;
    reason?: string;
    records: readonly RecordToLand[];
  },
): Promise<LandResult> {
  const results: LandedRecord[] = [];
  const counts = { created: 0, changed: 0, unchanged: 0, failed: 0 };

  for (const record of input.records) {
    const identity = {
      source: input.source,
      tenantId: input.tenantId,
      entity: record.entity,
      sourceRecordId: record.sourceRecordId,
    };
    try {
      const key = lakeKeyOf(identity);
      const put = await lake.put(key, encoder.encode(record.payloadText), {
        runId: input.runId,
        reason: input.reason ?? "",
        stream: streamOf(identity),
        extra: { sourceUpdatedAt: record.sourceUpdatedAt },
      });
      const status = statusOf(put);
      counts[status] += 1;
      results.push({
        entity: record.entity,
        sourceRecordId: record.sourceRecordId,
        status,
        sha256: put.sha256,
        lakeKey: key,
        ...(put.versionKey === "" ? {} : { stamp: put.versionKey.split("/").at(-1)! }),
      });
    } catch (error) {
      counts.failed += 1;
      results.push({
        entity: record.entity,
        sourceRecordId: record.sourceRecordId,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ...counts, results };
}

/**
 * A landing in the lake REST API's published shape, which predates the New / Changed split.
 *
 * On that wire `created` has always meant "a new version was written", so a record that
 * CHANGED is `created` there although the run's ledger counts it as changed. Collapsed here,
 * beside the split it collapses, so the rule for what the older contract means is stated once;
 * the contract is what a script already parses, and the finer split is on the run.
 */
export function publishedResponse(runId: string, result: LandResult): LandRecordsResponse {
  return {
    runId,
    created: result.created + result.changed,
    unchanged: result.unchanged,
    failed: result.failed,
    results: result.results.map((landed) => ({
      ...landed,
      status: landed.status === "changed" ? "created" : landed.status,
    })),
  };
}
