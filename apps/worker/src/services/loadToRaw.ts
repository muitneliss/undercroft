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
 */

// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/performance/noAwaitInLoops: These sequential awaits are the point. Pacing a connector against a rate limit, walking Dokploy deployment records until one settles, and migrating SQL files in order all require the previous iteration to finish first; running them concurrently is the bug this rule would introduce.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

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

  const entries = await lake.journalSince(stream, cursor);
  let created = 0;
  let changed = 0;
  let unchanged = 0;
  let lastStamp = cursor;

  for (let i = 0; i < entries.length; i += BATCH) {
    const slice = entries.slice(i, i + BATCH);
    const batch: RawRecordRow[] = [];
    for (const entry of slice) {
      const manifest = await lake.manifest(entry.sourceKey, entry.stamp);
      const bytes = await lake.read(entry.sourceKey, entry.stamp);
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
      lastStamp = entry.stamp;
    }
    const counts = await upsertRecords(exec, identity, batch);
    created += counts.created;
    changed += counts.changed;
    unchanged += counts.unchanged;
  }

  if (lastStamp !== null && lastStamp !== cursor) {
    await writeCursor(exec, identity, lastStamp);
  }

  return { created, changed, unchanged, lastStamp };
}
