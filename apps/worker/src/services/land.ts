/**
 * Landing records into the raw lake.
 *
 * One writer, many callers: the connector runtime lands here, and so does the lake REST
 * API when an external script pushes records. Both go through this function, so the
 * create-only and content-addressing guarantees hold whatever called it.
 *
 * The payload stored is the record's canonical text as bytes. Content addressing is over
 * those bytes, so re-landing an unchanged record reports `unchanged` and writes nothing.
 */

// biome-ignore-all lint/performance/noAwaitInLoops: These sequential awaits are the point. Pacing a connector against a rate limit, walking Dokploy deployment records until one settles, and migrating SQL files in order all require the previous iteration to finish first; running them concurrently is the bug this rule would introduce.
// biome-ignore-all lint/style/noNonNullAssertion: Almost all of these are tests asserting on a fixture they created three lines earlier, which the ESLint config this replaced also exempted for the same reason. Biome's unsafe autofix for the rule deletes the `!` and leaves `string | undefined` flowing into a `string`, so it does not compile.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

import { lakeKeyOf, streamOf } from "@undercroft/contracts";
import type { LakeStore } from "@undercroft/lake";

export interface RecordToLand {
  readonly entity: string;
  readonly sourceRecordId: string;
  readonly sourceUpdatedAt: string | null;
  readonly payloadText: string;
}

export interface LandedRecord {
  readonly entity: string;
  readonly sourceRecordId: string;
  readonly status: "created" | "unchanged" | "failed";
  readonly sha256?: string;
  readonly lakeKey?: string;
  readonly stamp?: string;
  readonly reason?: string;
}

export interface LandResult {
  readonly created: number;
  readonly unchanged: number;
  readonly failed: number;
  readonly results: LandedRecord[];
}

const encoder = new TextEncoder();

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
  let created = 0;
  let unchanged = 0;
  let failed = 0;

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
      if (put.status === "created") {
        created += 1;
      } else {
        unchanged += 1;
      }
      results.push({
        entity: record.entity,
        sourceRecordId: record.sourceRecordId,
        status: put.status,
        sha256: put.sha256,
        lakeKey: key,
        ...(put.versionKey === "" ? {} : { stamp: put.versionKey.split("/").at(-1)! }),
      });
    } catch (error) {
      failed += 1;
      results.push({
        entity: record.entity,
        sourceRecordId: record.sourceRecordId,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { created, unchanged, failed, results };
}
