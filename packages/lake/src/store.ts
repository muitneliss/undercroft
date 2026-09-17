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
import { type ObjectStore } from "./objectStore.ts";

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

/** Reserved key prefixes, written only by the store. `validateSourceKey` keeps callers out. */
const RESERVED_PREFIXES = ["_blobs/", "_journal/"] as const;

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

/**
 * Validate a journal stream: the `source/tenant/entity` prefix a loader pages by.
 *
 * Kept separate from `validateSourceKey` because a stream is deliberately a *container*
 * (it names a set of records), which the source-key rule forbids. It still must not be
 * empty, traverse, or shadow a reserved prefix.
 */
function validateStream(stream: string): string {
  const s = stream.replace(/^\/+|\/+$/g, "");
  if (s === "") throw new RangeError("journal stream must not be empty");
  if (s.split("/").includes("..")) {
    throw new RangeError(`journal stream must not traverse: ${JSON.stringify(stream)}`);
  }
  if (RESERVED_PREFIXES.some((p) => `${s}/`.startsWith(p))) {
    throw new RangeError(
      `journal stream must not shadow a reserved prefix: ${JSON.stringify(stream)}`,
    );
  }
  return s;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

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

  static blobKey(digest: string): string {
    return `_blobs/${digest.slice(0, 2)}/${digest}`;
  }

  static journalKey(stream: string, stamp: string, digest: string): string {
    // Stream first, then stamp, so listing `_journal/{stream}/` sorts by observation
    // time and a plain `StartAfter` over it is an incremental-load cursor. The digest
    // tail disambiguates two observations that share a microsecond.
    return `_journal/${validateStream(stream)}/${stamp}/${digest.slice(0, 12)}`;
  }

  /**
   * Reject key shapes that make pruning dangerous.
   *
   * In a provenance store, listing every subdirectory of a key and treating each as a
   * version means a key naming an *intermediate* node makes prune walk entity directories
   * and delete customer data. The shape is enforced here, at the only place keys enter
   * the store, rather than promised in a docstring no line of code keeps.
   */
  static validateSourceKey(sourceKey: string): string {
    const key = sourceKey.replace(/^\/+|\/+$/g, "");
    if (key === "") throw new RangeError("source_key must not be empty");
    const segments = key.split("/");
    if (segments.includes("..")) {
      throw new RangeError(`source_key must not traverse: ${JSON.stringify(sourceKey)}`);
    }
    if (RESERVED_PREFIXES.some((p) => `${key}/`.startsWith(p))) {
      throw new RangeError(
        `source_key must not shadow a reserved prefix: ${JSON.stringify(sourceKey)}`,
      );
    }
    if (segments.length < 2) {
      throw new RangeError(
        `source_key ${JSON.stringify(sourceKey)} is too shallow: it must name a leaf ` +
          "(e.g. 'xero/invoices/INV-001'), not a container. A container key would make " +
          "retention prune sibling entities.",
      );
    }
    return key;
  }

  // -- writing --------------------------------------------------------------

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
    const manifestKey = `${versionKey}/manifest.json`;
    if (await this.#store.exists(manifestKey)) {
      throw new ObjectExists(
        `refusing to overwrite an existing observation at ${manifestKey}. ` +
          "The raw lake is create-only.",
      );
    }

    const manifest: Record<string, unknown> = {
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
    };
    await this.#store.put(manifestKey, encoder.encode(JSON.stringify(manifest, null, 2)));

    // Journal pointer, written on `created` only. Lets the loader page new observations
    // for a stream with a single prefix scan instead of re-reading every key.
    if (opts.stream !== undefined) {
      const journalKey = LakeStore.journalKey(opts.stream, stamp, digest);
      await this.#store.put(
        journalKey,
        encoder.encode(JSON.stringify({ sourceKey: key, stamp, sha256: digest })),
      );
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
      if (isStamp(head)) stamps.add(head);
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
    if (newest === undefined) return null;
    const man = await this.manifest(sourceKey, newest);
    return typeof man.sha256 === "string" ? man.sha256 : null;
  }

  /**
   * Return the payload bytes for an observation, verifying the digest.
   *
   * A mismatch raises rather than returning suspect bytes: silent corruption flowing
   * downstream is far more expensive than a loud failure, and a hash of the wrong bytes is
   * still a valid hash, so our own re-hash is the only thing that catches a truncated read.
   */
  async read(sourceKey: string, stamp?: string): Promise<Uint8Array> {
    const key = LakeStore.validateSourceKey(sourceKey);
    const stamps = await this.versions(key);
    const chosen = stamp ?? stamps.at(-1);
    if (chosen === undefined) throw new RangeError(`no observations at ${key}`);
    const man = await this.manifest(key, chosen);
    const blobKey = man.blobKey;
    if (typeof blobKey !== "string")
      throw new Error(`manifest for ${key}/${chosen} has no blobKey`);
    const data = await this.#store.get(blobKey);
    const actual = await sha256Hex(data);
    if (actual !== man.sha256) {
      throw new ObjectExists(
        `blob for ${key}/${chosen} is corrupt: manifest says ${String(man.sha256)}, bytes hash to ${actual}`,
      );
    }
    return data;
  }

  // -- journal --------------------------------------------------------------

  /**
   * Journal entries for `stream` with a stamp strictly greater than `afterStamp`, oldest
   * first. This is the loader's incremental cursor: pass the last stamp it processed.
   */
  async journalSince(stream: string, afterStamp: string | null): Promise<JournalEntry[]> {
    const prefix = `_journal/${validateStream(stream)}/`;
    const entries: JournalEntry[] = [];
    for (const obj of await this.#store.list(prefix)) {
      const stamp = obj.slice(prefix.length).split("/", 1)[0] ?? "";
      if (!isStamp(stamp)) continue;
      if (afterStamp !== null && stamp <= afterStamp) continue;
      const bytes = await this.#store.get(obj);
      entries.push(JSON.parse(decoder.decode(bytes)) as JournalEntry);
    }
    entries.sort((a, b) => (a.stamp < b.stamp ? -1 : a.stamp > b.stamp ? 1 : 0));
    return entries;
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
    if (this.#retention === undefined) return [];
    const key = LakeStore.validateSourceKey(sourceKey);
    const stamps = await this.versions(key);
    const excess = stamps.length - this.#retention;
    if (excess <= 0) return [];
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

export { sha256Hex };
