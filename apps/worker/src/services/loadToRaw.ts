/**
 * Project the lake into `raw.records`, incrementally and idempotently.
 *
 * The lake is the durable archive; `raw.records` is a rebuildable index over the newest
 * observation of each record. This loader reads the per-stream journal from where it last
 * stopped, so its cost is proportional to *new* observations, not to the size of the lake
 * -- the O(all records) trap the Python's prefix-scan fell into.
 *
 * The two guarantees that make re-running safe -- an unchanged payload writes nothing, and
 * a late-arriving older observation never overwrites a newer row -- are enforced in SQL, in
 * `../repos/rawRecords.ts`. They belong there rather than here on purpose: a check in this
 * loop would only bind this loop, and two loaders running at once are exactly the case that
 * has to hold.
 *
 * What stays here is the shape of the pass: resume from the cursor, read each observation
 * out of the lake, batch it, and move the cursor only as far as it actually got.
 *
 * "As far as it actually got" is per BATCH, not per pass. A pass over a mailbox is tens of
 * thousands of observations and the process running it has died mid-pass before; writing the
 * cursor once at the end meant the work of every completed batch was thrown away and redone
 * from the beginning on the next run, which is how a projection that is interrupted twice
 * never finishes. Written per batch it costs one small UPSERT per 500 rows and a crash costs
 * one batch.
 *
 * ## Called per landed chunk, so nothing here may assume it is called once
 *
 * `services/landing.ts` runs this from inside a sink's flush, once per chunk of records it
 * lands, because what the NEXT run skips is what `raw.records` holds -- a run that projected
 * only at the end of an entity and was then killed would leave the whole mailbox in the lake
 * with nothing to skip. Resuming from the cursor is also what makes the first of those calls
 * the recovery step for whatever a previous dead run left unprojected, with no separate
 * catch-up call to forget to make.
 *
 * Being called that often is only affordable because a pass costs its NEW observations and
 * nothing else: `journalSince` scans from the cursor and yields rather than materialising, so
 * the pass after a chunk reads that chunk, and one observation is one `LakeStore.observation`
 * rather than a LIST and two manifest reads.
 */

import { streamOf } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import type { LakeStore } from "@undercroft/lake";
import { type RawRecordRow, readCursor, upsertRecords, writeCursor } from "../repos/rawRecords.ts";

const decoder = new TextDecoder();

export interface LoadResult {
  readonly created: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly lastStamp: string | null;
}

const BATCH = 500;

export async function loadStreamToRaw(
  exec: SqlExecutor,
  lake: LakeStore,
  identity: { source: string; tenantId: string; entity: string },
): Promise<LoadResult> {
  const stream = streamOf(identity);
  const cursor = await readCursor(exec, identity);

  let created = 0;
  let changed = 0;
  let unchanged = 0;
  let lastStamp = cursor;
  let batch: RawRecordRow[] = [];
  let reached: string | null = null;

  async function writeBatch(): Promise<void> {
    if (batch.length === 0) {
      return;
    }
    const counts = await upsertRecords(exec, identity, batch);
    created += counts.created;
    changed += counts.changed;
    unchanged += counts.unchanged;
    batch = [];

    // The journal arrives in stamp order, so the last entry taken into a batch is the
    // furthest this pass has reached. The cursor moves only after that batch is in
    // `raw.records`: ahead of the rows it claims, it would skip them forever.
    if (reached !== null && reached !== lastStamp) {
      await writeCursor(exec, identity, reached);
      lastStamp = reached;
    }
  }

  for await (const entry of lake.journalSince(stream, cursor)) {
    // One call, one manifest. Asking for the manifest and then for the bytes read the
    // manifest twice and LISTed the key's observations to find a stamp this entry already
    // names -- four round trips per record where two will do, over a pass that runs per
    // landed chunk now rather than once per entity.
    const { bytes, manifest } = await lake.observation(entry.sourceKey, entry.stamp);
    batch.push({
      sourceRecordId: entry.sourceKey.slice(stream.length + 1),
      payloadText: decoder.decode(bytes),
      contentSha256: entry.sha256,
      sourceUpdatedAt: (manifest.sourceUpdatedAt as string | null | undefined) ?? null,
      observedAt: String(manifest.observedAt),
      lakeKey: entry.sourceKey,
      lakeStamp: entry.stamp,
      runId: String(manifest.runId),
    });
    reached = entry.stamp;
    if (batch.length >= BATCH) {
      await writeBatch();
    }
  }
  await writeBatch();

  return { created, changed, unchanged, lastStamp };
}
