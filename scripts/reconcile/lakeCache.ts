/**
 * Lake walks kept on disk for a while, so repeated runs in one working session do not re-read
 * every row of a source through a 50-row CLI page.
 *
 * A CACHED WALK IS A SNAPSHOT, AND SAYS SO. Every walk served records the moment it was taken
 * in `snapshots`; the CLI writes those into the run's watermarks, so a report built on a cached
 * walk states which lake it compared -- "the lake at 15:58", never "the lake now".
 *
 * A SNAPSHOT A RUN HAS SINCE WRITTEN TO IS NOT REUSED. The run ledger is always read live, so
 * the comparison's watermark is the newest completed run; a walk taken before that run would
 * miss what it landed while the watermark says it should be there, and every such record would
 * read as undecidable. A walk is reused only while no run of its source has ended -- or is still
 * running -- after the walk was taken.
 */

import { arrayOrEmpty, asArray, asObject, count } from "./json.ts";
import type { Walk } from "./paginate.ts";
import { parseDocument, parseRecord } from "./lakeParse.ts";
import type { LakeDocument, LakeRecord, Run, UndercroftReader } from "./undercroft.ts";

export interface WalkStore {
  read: (name: string) => { savedAt: number; walk: unknown } | null;
  write: (name: string, walk: unknown) => void;
}

export interface CachedReader extends UndercroftReader {
  /** Walk name -> ISO time the walk was taken. */
  readonly snapshots: ReadonlyMap<string, string>;
}

export function cachedUndercroft(
  reader: UndercroftReader,
  store: WalkStore,
  maxAgeMs: number,
  now: () => number,
): CachedReader {
  const snapshots = new Map<string, string>();
  let ledger: Promise<readonly Run[]> | null = null;
  async function writtenSince(source: string, savedAt: number): Promise<boolean> {
    ledger ??= reader.runs(100);
    return (await ledger).some(
      (run) => run.source === source && (run.endedAt === null || Date.parse(run.endedAt) > savedAt),
    );
  }
  async function cached<T>(
    name: string,
    source: string,
    load: () => Promise<Walk<T>>,
    parse: (item: unknown) => T,
  ): Promise<Walk<T>> {
    const hit = store.read(name);
    if (
      hit !== null &&
      now() - hit.savedAt <= maxAgeMs &&
      !(await writtenSince(source, hit.savedAt))
    ) {
      snapshots.set(name, new Date(hit.savedAt).toISOString());
      return reviveWalk(hit.walk, parse);
    }
    const walk = await load();
    store.write(name, { ...walk, repeats: [...walk.repeats.entries()] });
    snapshots.set(name, new Date(now()).toISOString());
    return walk;
  }
  return {
    summary: () => reader.summary(),
    connections: () => reader.connections(),
    runs: (limit) => reader.runs(limit),
    snapshots,
    records: (source, entity, declaredTotal): Promise<Walk<LakeRecord>> =>
      cached(
        `records-${source}-${entity}`,
        source,
        () => reader.records(source, entity, declaredTotal),
        parseRecord,
      ),
    documents: (source, declaredTotal): Promise<Walk<LakeDocument>> =>
      cached(
        `documents-${source}`,
        source,
        () => reader.documents(source, declaredTotal),
        parseDocument,
      ),
  };
}

function reviveWalk<T>(raw: unknown, parse: (item: unknown) => T): Walk<T> {
  const body = asObject(raw);
  const repeats = arrayOrEmpty(body.repeats).map((entry) => {
    const [id, times] = asArray(entry);
    return [String(id), count(times)] as const;
  });
  return {
    items: asArray(body.items).map(parse),
    pages: count(body.pages),
    exhausted: body.exhausted === true,
    truncatedByCap: body.truncatedByCap === true,
    loopDetected: body.loopDetected === true,
    repeats: new Map(repeats),
    shortBy: typeof body.shortBy === "number" ? body.shortBy : null,
  };
}
