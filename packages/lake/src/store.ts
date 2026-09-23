/**
 * Content-addressed immutable object store for the raw lake.
 *
 * The raw lake is the only layer that **cannot be recomputed**. If a source edits or
 * deletes their side, whatever we did not capture is gone permanently. Everything
 * downstream -- curated tables, marts, dashboards -- is a projection that may be dropped
 * and rebuilt freely. That asymmetry is the whole design.
 *
 * Three invariants, each pinned by a test:
 *
 * 1. **Create-only.** Writing where an object already exists is an error, never a silent
 *    replace. A store that can be overwritten is a cache, not an archive.
 *
 * 2. **Idempotent by content.** Re-storing identical bytes writes nothing and reports
 *    `unchanged`. Without this, an hourly schedule pushes real history out through
 *    retention using nothing but copies of the same file.
 *
 * 3. **Retention is bounded and reported.** Pruning names what it removed. Silent pruning
 *    of a durable store is indistinguishable from data loss.
 *
 * Content addressing is the default here, not a later optimisation. A legacy store
 * addressed by provenance held 15,790 artefacts over 5,259 distinct payloads -- 10.42 GB
 * where 1.98 GB would do, with one 6.8 MB document stored under 126 separate keys.
 * Starting content-addressed skips the entire problem.
 */

import { createStampSource, isStamp, type StampSource, systemClock } from "@undercroft/core";
import type { ObjectStore } from "./objectStore.ts";
import {
  blobKey as blobKeyOf,
  journalKey as journalKeyOf,
  sha256Hex,
  validateSourceKey as validateSourceKeyOf,
  validateStream,
} from "./keys.ts";

/**
 * Default retention: `undefined` means keep every observation, forever.
 *
 * A deliberate decision, not an oversight. The lake is the only layer that cannot be
 * recomputed, and no retention policy has been set, so the safe default is to discard
 * nothing. Create-only plus content-idempotence already bounds growth by *real* change:
 * re-observing an unchanged file costs one manifest, not one copy.
 *
 * This will need revisiting under any data-retention regulation, where "keep everything"
 * is a starting position with a deadline, not a permanent policy.
 */
export const RETENTION_UNBOUNDED = undefined;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class ObjectExists extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectExists";
  }
}

export interface PutResult {
  /**
   * `created` or `unchanged`. Callers use it to tell "we observed new data" from "we
   * observed the same data again" -- the difference between a live source and a silently
   * stalled one.
   */
  readonly status: "created" | "unchanged";
  readonly sha256: string;
  readonly blobKey: string;
  readonly versionKey: string;
  readonly bytes: number;
  readonly pruned: readonly string[];
}

/** One entry in the journal: enough to load an observation without listing the lake. */
export interface JournalEntry {
  readonly sourceKey: string;
  readonly stamp: string;
  readonly sha256: string;
}

/** One observation: the payload bytes and the manifest that describes them. */
export interface Observation {
  readonly bytes: Uint8Array;
  readonly manifest: Record<string, unknown>;
}

/**
 * Validate a journal stream: the `source/tenant/entity` prefix a loader pages by.
 *
 * Kept separate from `validateSourceKey` because a stream is deliberately a *container*
 * (it names a set of records), which the source-key rule forbids. It still must not be
 * empty, traverse, or shadow a reserved prefix.
 */
export interface LakeStoreOptions {
  /** Keep at most this many observations per key. `undefined` keeps everything. Min 1. */
  readonly retention?: number | undefined;
  readonly stamps?: StampSource;
}

export class LakeStore {
  readonly #store: ObjectStore;
  readonly #retention: number | undefined;
  readonly #stamps: StampSource;

  constructor(store: ObjectStore, options: LakeStoreOptions = {}) {
    const retention = options.retention ?? RETENTION_UNBOUNDED;
    if (retention !== undefined && retention < 1) {
      throw new RangeError("retention must be at least 1, or undefined to keep everything");
    }
    this.#store = store;
    this.#retention = retention;
    this.#stamps = options.stamps ?? createStampSource(systemClock);
  }

  // -- keys -----------------------------------------------------------------
  //
  // Delegates. The grammar itself lives in `keys.ts`, because what a key may look like is a
  // rule about the lake rather than a behaviour of this class -- and it is the rule that
  // keeps `prune` from ever walking an entity directory. See that module.

  static blobKey(digest: string): string {
    return blobKeyOf(digest);
  }

  static journalKey(stream: string, stamp: string, digest: string): string {
    return journalKeyOf(stream, stamp, digest);
  }

  static validateSourceKey(sourceKey: string): string {
    return validateSourceKeyOf(sourceKey);
  }

  // -- writing --------------------------------------------------------------

  /**
   * Write the manifest, refusing to replace one.
   *
   * This is the create-only rule at its narrowest point: `raw-lake.md` says a store that can
   * be overwritten is a cache rather than an archive, and this is the one statement that
   * makes that true of an observation.
   */
  async #createManifest(versionKey: string, manifest: Record<string, unknown>): Promise<void> {
    const manifestKey = `${versionKey}/manifest.json`;
    if (await this.#store.exists(manifestKey)) {
      throw new ObjectExists(
        `refusing to overwrite an existing observation at ${manifestKey}. ` +
          "The raw lake is create-only.",
      );
    }
    await this.#store.put(manifestKey, encoder.encode(JSON.stringify(manifest, null, 2)));
  }

  /** The stream pointer that lets the loader page new observations with one prefix scan. */
  async #createJournalPointer(
    stream: string,
    stamp: string,
    digest: string,
    sourceKey: string,
  ): Promise<void> {
    const journalKey = LakeStore.journalKey(stream, stamp, digest);
    await this.#store.put(
      journalKey,
      encoder.encode(JSON.stringify({ sourceKey, stamp, sha256: digest })),
    );
  }

  /**
   * Store `data` observed at `sourceKey`.
   *
   * Returns `unchanged` without writing if the newest observation at this key already has
   * these bytes.
   */
  async put(
    sourceKey: string,
    data: Uint8Array,
    opts: {
      runId: string;
      reason?: string;
      extra?: Record<string, unknown>;
      /**
       * The `source/tenant/entity` stream this observation belongs to. When given, a
       * journal pointer is written so the loader can page new observations for the
       * stream without listing the whole lake. Omit for byte paths that are loaded by a
       * different mechanism.
       */
      stream?: string;
    },
  ): Promise<PutResult> {
    const key = LakeStore.validateSourceKey(sourceKey);
    const digest = await sha256Hex(data);
    const blob = LakeStore.blobKey(digest);

    if ((await this.newestSha(key)) === digest) {
      return {
        status: "unchanged",
        sha256: digest,
        blobKey: blob,
        versionKey: "",
        bytes: data.byteLength,
        pruned: [],
      };
    }

    // The blob is shared, so an existing one with a matching digest is not a collision --
    // it is deduplication working. Only write if absent.
    if (!(await this.#store.exists(blob))) {
      await this.#store.put(blob, data);
    }

    const stamp = this.#stamps.next();
    const versionKey = `${key}/${stamp}`;
    await this.#createManifest(versionKey, {
      sourceKey: key,
      sha256: digest,
      blobKey: blob,
      bytes: data.byteLength,
      runId: opts.runId,
      observedAt: systemClock.now().toISOString(),
      reason: opts.reason ?? "",
      // `rowCount` is deliberately absent unless a caller supplies one it can define.
      // A number with no definition is worse than no number.
      ...(opts.extra ?? {}),
    });

    // Journal pointer, written on `created` only. Lets the loader page new observations
    // for a stream with a single prefix scan instead of re-reading every key.
    if (opts.stream !== undefined) {
      await this.#createJournalPointer(opts.stream, stamp, digest, key);
    }

    const pruned = await this.prune(key);
    return {
      status: "created",
      sha256: digest,
      blobKey: blob,
      versionKey,
      bytes: data.byteLength,
      pruned,
    };
  }

  // -- reading --------------------------------------------------------------

  /** Observation stamps at this key, oldest first. Anything not a stamp is not ours. */
  async versions(sourceKey: string): Promise<string[]> {
    const key = LakeStore.validateSourceKey(sourceKey);
    const stamps = new Set<string>();
    for (const obj of await this.#store.list(`${key}/`)) {
      const rest = obj.slice(key.length + 1);
      const head = rest.split("/", 1)[0] ?? "";
      if (isStamp(head)) {
        stamps.add(head);
      }
    }
    return [...stamps].sort();
  }

  async manifest(sourceKey: string, stamp: string): Promise<Record<string, unknown>> {
    const key = LakeStore.validateSourceKey(sourceKey);
    const bytes = await this.#store.get(`${key}/${stamp}/manifest.json`);
    return JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
  }

  async newestSha(sourceKey: string): Promise<string | null> {
    const stamps = await this.versions(sourceKey);
    const newest = stamps.at(-1);
    if (newest === undefined) {
      return null;
    }
    const man = await this.manifest(sourceKey, newest);
    return typeof man.sha256 === "string" ? man.sha256 : null;
  }

  /**
   * Read one observation, verifying the digest.
   *
   * A mismatch raises rather than returning suspect bytes: silent corruption flowing
   * downstream is far more expensive than a loud failure, and a hash of the wrong bytes is
   * still a valid hash, so our own re-hash is the only thing that catches a truncated read.
   */
  async #observationAt(key: string, stamp: string): Promise<Observation> {
    const man = await this.manifest(key, stamp);
    const { blobKey } = man;
    if (typeof blobKey !== "string") {
      throw new Error(`manifest for ${key}/${stamp} has no blobKey`);
    }
    const data = await this.#store.get(blobKey);
    const actual = await sha256Hex(data);
    if (actual !== man.sha256) {
      throw new ObjectExists(
        `blob for ${key}/${stamp} is corrupt: manifest says ${String(man.sha256)}, bytes hash to ${actual}`,
      );
    }
    return { bytes: data, manifest: man };
  }

  /**
   * A named observation, bytes and manifest together.
   *
   * The loader wants both -- the payload to project, and `observedAt`, `runId` and
   * `sourceUpdatedAt` from the manifest to stamp the row with -- and asking for them
   * separately fetched the manifest twice per record. At 7,786 records that is the
   * difference between a phase and a pause. The manifest is read once here and handed back
   * whole, so the caller keeps the fields it needs without the store guessing which.
   */
  async observation(sourceKey: string, stamp: string): Promise<Observation> {
    return await this.#observationAt(LakeStore.validateSourceKey(sourceKey), stamp);
  }

  /** The payload bytes of an observation; the newest one when no stamp is named. */
  async read(sourceKey: string, stamp?: string): Promise<Uint8Array> {
    const key = LakeStore.validateSourceKey(sourceKey);
    // Only a caller that did NOT say which observation it wants needs this listing. The
    // loader always knows -- the journal entry it is reading names the stamp -- and used to
    // pay for the LIST anyway, once per record, for an answer it then discarded.
    const chosen = stamp ?? (await this.versions(key)).at(-1);
    if (chosen === undefined) {
      throw new RangeError(`no observations at ${key}`);
    }
    return (await this.#observationAt(key, chosen)).bytes;
  }

  // -- journal --------------------------------------------------------------

  /**
   * Journal entries for `stream` with a stamp strictly greater than `afterStamp`, oldest
   * first. This is the loader's incremental cursor: pass the last stamp it processed.
   *
   * **Yielded, not returned as an array.** A stream with a year of history has more entries
   * than the process paging it should have to hold at once, and the loader batches anyway,
   * so the array was a copy of the whole journal kept alive for nothing.
   *
   * **The scan starts at the cursor.** `keys.ts` puts the stamp ahead of the digest, and
   * `core/stamp.ts` keeps stamps fixed-width and lexically ordered, so that a listing of
   * this prefix sorts by observation time and a plain `StartAfter` over it IS this cursor.
   * Both modules have said so since the key layout was designed; this is where it is
   * finally used, and until it was, every call read the stream's entire history back to
   * filter almost all of it out.
   *
   * The `stamp <= afterStamp` test below remains the authority on which entries are new.
   * `startAfter` only narrows what is read -- the boundary key is a prefix of the entries
   * AT the cursor, so the store still lists those and the filter is what drops them.
   *
   * Order comes from the key layout rather than from a sort: the stamp is the first segment
   * after the stream, and `list` promises code-unit order.
   */
  async *journalSince(stream: string, afterStamp: string | null): AsyncGenerator<JournalEntry> {
    const prefix = `_journal/${validateStream(stream)}/`;
    const from = afterStamp === null ? undefined : `${prefix}${afterStamp}`;
    for (const obj of await this.#store.list(prefix, from)) {
      const stamp = obj.slice(prefix.length).split("/", 1)[0] ?? "";
      if (!isStamp(stamp)) {
        continue;
      }
      if (afterStamp !== null && stamp <= afterStamp) {
        continue;
      }
      const bytes = await this.#store.get(obj);
      yield JSON.parse(decoder.decode(bytes)) as JournalEntry;
    }
  }

  // -- retention ------------------------------------------------------------

  /**
   * Trim to `retention` observations, oldest first. Returns what it removed.
   *
   * Blobs are never pruned here. A blob may be referenced by observations at other keys,
   * and deciding whether one is safe to delete is a separate, deliberate
   * garbage-collection step -- not a retention side effect.
   */
  async prune(sourceKey: string): Promise<string[]> {
    if (this.#retention === undefined) {
      return [];
    }
    const key = LakeStore.validateSourceKey(sourceKey);
    const stamps = await this.versions(key);
    const excess = stamps.length - this.#retention;
    if (excess <= 0) {
      return [];
    }
    const removed: string[] = [];
    for (const stamp of stamps.slice(0, excess)) {
      for (const obj of await this.#store.list(`${key}/${stamp}/`)) {
        await this.#store.delete(obj);
      }
      removed.push(stamp);
    }
    return removed;
  }
}
