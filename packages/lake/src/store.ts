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
 * One kind of object is not kept: a DOCUMENT's bytes, once the extract pass has had its attempt
 * at them (ADR 0161, the owner's decision -- the file lives in the customer's own Drive or
 * mailbox). That is `purgeBlobs`, which is told which digests to remove by a caller that knows
 * what a document is, reports before it deletes, and leaves every manifest and journal pointer
 * where it was. Nothing in this class decides that a blob may go.
 *
 * Content addressing is the default here, not a later optimisation. A legacy store
 * addressed by provenance held 15,790 artefacts over 5,259 distinct payloads -- 10.42 GB
 * where 1.98 GB would do, with one 6.8 MB document stored under 126 separate keys.
 * Starting content-addressed skips the entire problem.
 */

import { createStampSource, isStamp, type StampSource, systemClock } from "@undercroft/core";
import { byCodeUnit } from "@undercroft/core/order";
import { type Canonicaliser, type Considered, redundantStamps } from "./compaction.ts";
import { ObjectNotFound, type ObjectStore } from "./objectStore.ts";
import {
  blobKey as blobKeyOf,
  journalKey as journalKeyOf,
  reportKey as reportKeyOf,
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

/**
 * An observation's manifest names a blob the lake does not hold -- removed by `purgeBlobs` once
 * the bytes had been read (ADR 0161), or never written.
 *
 * Its own class so a reader can say which: "these bytes were purged after extraction" is a fact
 * about the archive, and a reader that met it as a bare `no such object` reported a missing
 * file as a broken store. The manifest is still there, so the observation is still traceable.
 */
export class BlobAbsent extends Error {
  readonly sha256: string;

  constructor(of: { version: string; sha256: string }, options?: { cause?: unknown }) {
    super(
      `the bytes of ${of.version} are not in the lake: blob ${of.sha256} is absent -- purged ` +
        "after extraction (ADR 0161) or never stored. Its manifest remains.",
      options,
    );
    this.name = "BlobAbsent";
    this.sha256 = of.sha256;
  }
}

/** What `purgeBlobs` did: where it said so first, and each digest's outcome. */
export interface BlobPurge {
  /** The `_reports/blob-purge/` object written BEFORE anything was deleted. */
  readonly report: string;
  /** Digests whose blob was there and is gone. */
  readonly deleted: readonly string[];
  /** Digests whose blob was already gone: nothing to delete, and said so rather than counted. */
  readonly absent: readonly string[];
}

/** The kind under `_reports/` a blob purge is written as. */
const PURGE_REPORT_KIND = "blob-purge";

/** Blobs checked and deleted at once: round trips in flight over a tunnel, not CPU. */
const PURGE_LANES = 16;

const DIGEST = /^[0-9a-f]{64}$/u;

export interface PutResult {
  /**
   * `created` or `unchanged`. Callers use it to tell "we observed new data" from "we
   * observed the same data again" -- the difference between a live source and a silently
   * stalled one.
   */
  readonly status: "created" | "unchanged";
  readonly sha256: string;
  /**
   * The digest of the newest observation at this key BEFORE this put, or `null` when the key
   * had none -- so a `created` put says whether it was the key's first observation or a new
   * version of one already held, and an `unchanged` put carries its own `sha256` here.
   *
   * Reported rather than left for the caller to ask `newestSha` first, because `put` has
   * already read it to decide `unchanged`: a second read would double the cost of every write
   * and could answer about a different moment than the one the write was decided on.
   */
  readonly previousSha256: string | null;
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

const MANIFEST_SUFFIX = "/manifest.json";

/**
 * What `applyCompaction` will remove at one key, and the reading it was decided on.
 *
 * A value, so a dry run is simply a plan nobody applies, and a caller can record it before
 * anything is deleted.
 */
export interface CompactionPlan {
  readonly stream: string;
  readonly sourceKey: string;
  /** The newest stamp considered; nothing after it is touched. `null` considers nothing. */
  readonly through: string | null;
  /** Every stamp at or before `through` when the plan was made, oldest first. */
  readonly examined: readonly string[];
  /** The observations to remove, oldest first, with the digest each journal pointer names. */
  readonly remove: readonly { readonly stamp: string; readonly sha256: string }[];
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

    const previous = await this.newestSha(key);
    if (previous === digest) {
      return {
        status: "unchanged",
        sha256: digest,
        previousSha256: previous,
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
      previousSha256: previous,
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
    return [...(await this.#objectsByStamp(key)).keys()].sort(byCodeUnit);
  }

  /** Every object under each observation of `key`, by stamp, from one listing. */
  async #objectsByStamp(key: string): Promise<Map<string, string[]>> {
    const byStamp = new Map<string, string[]>();
    for (const obj of await this.#store.list(`${key}/`)) {
      const rest = obj.slice(key.length + 1);
      const head = rest.split("/", 1)[0] ?? "";
      if (isStamp(head)) {
        byStamp.set(head, [...(byStamp.get(head) ?? []), obj]);
      }
    }
    return byStamp;
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
    return { bytes: await this.#verifiedBytes(`${key}/${stamp}`, man), manifest: man };
  }

  /** The bytes a manifest names, refused unless they hash to what it says. */
  async #verifiedBytes(version: string, man: Record<string, unknown>): Promise<Uint8Array> {
    const { blobKey } = man;
    if (typeof blobKey !== "string") {
      throw new Error(`manifest for ${version} has no blobKey`);
    }
    let data: Uint8Array;
    try {
      data = await this.#store.get(blobKey);
    } catch (error) {
      if (error instanceof ObjectNotFound) {
        throw new BlobAbsent({ version, sha256: String(man.sha256) }, { cause: error });
      }
      throw error;
    }
    const actual = await sha256Hex(data);
    if (actual !== man.sha256) {
      throw new ObjectExists(
        `blob for ${version} is corrupt: manifest says ${String(man.sha256)}, bytes hash to ${actual}`,
      );
    }
    return data;
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

  // -- compaction -----------------------------------------------------------
  //
  // Removing observations that repeat the one kept before them, which ADR 0158's Consequences
  // left as "a separate, explicit compaction step". ADR 0160 argues each choice below; the rule
  // itself is `compaction.ts`. It is split into a plan and its application because a dry run IS
  // the plan, and because the caller records the plan durably BEFORE anything is deleted -- so
  // an interrupted run has still said what it set out to remove.

  /** The source keys holding at least one observation in `stream`, sorted. One listing. */
  async recordKeys(stream: string): Promise<string[]> {
    const prefix = `${validateStream(stream)}/`;
    const keys = new Set<string>();
    for (const obj of await this.#store.list(prefix)) {
      if (!obj.endsWith(MANIFEST_SUFFIX)) {
        continue;
      }
      const version = obj.slice(0, -MANIFEST_SUFFIX.length);
      const cut = version.lastIndexOf("/");
      if (isStamp(version.slice(cut + 1))) {
        keys.add(version.slice(0, cut));
      }
    }
    return [...keys].sort(byCodeUnit);
  }

  /**
   * What compacting `sourceKey` would remove, deleting nothing.
   *
   * Only observations stamped at or before `through` are considered -- the caller's word for
   * how far the loader has projected the stream (`raw.load_cursor`), so nothing the loader has
   * yet to read is touched, and `null` (never loaded) considers nothing. A blob is read once per
   * digest: a key flip-flopping between two payloads costs two reads, not thirty.
   */
  async planCompaction(
    stream: string,
    sourceKey: string,
    canonical: Canonicaliser,
    through: string | null,
  ): Promise<CompactionPlan> {
    const key = LakeStore.validateSourceKey(sourceKey);
    if (!key.startsWith(`${validateStream(stream)}/`)) {
      throw new RangeError(`${JSON.stringify(key)} is not a record of stream ${stream}`);
    }
    const examined =
      through === null ? [] : (await this.versions(key)).filter((stamp) => stamp <= through);
    const digests = new Map<string, string>();
    const texts = new Map<string, string | null>();
    const considered: Considered[] = [];
    for (const stamp of examined) {
      const man = await this.manifest(key, stamp);
      const digest = String(man.sha256);
      if (!texts.has(digest)) {
        texts.set(digest, canonical(await this.#verifiedBytes(`${key}/${stamp}`, man)));
      }
      digests.set(stamp, digest);
      considered.push({ stamp, canonical: texts.get(digest) ?? null });
    }
    const remove = redundantStamps(considered).map((stamp) => ({
      stamp,
      sha256: digests.get(stamp) ?? "",
    }));
    return { stream: validateStream(stream), sourceKey: key, through, examined, remove };
  }

  /**
   * Remove what `plan` named, unless the key moved since it was made. Returns whether it did.
   *
   * The key is listed again first, and the plan is applied only if the observations at or
   * before its `through` are still exactly the ones it examined. A key that gained a NEWER
   * observation meanwhile is fine -- that one is past `through` and untouched -- but anything
   * else (a retention prune, a second compaction) is answered `false` and left for the next run
   * to plan afresh, rather than deleting on a reading that is no longer true. The plan never
   * holds the last stamp it examined, so the key's newest observation is never removed.
   *
   * The journal pointer goes FIRST, then the manifest. Stopped between the two, the lake holds
   * an observation no pointer names, which the next run finds redundant again and finishes; the
   * other order would leave a pointer to nothing, and `journalSince(null)` -- a rebuild of
   * `raw.records` -- would fail on it. Deleting an absent object is not an error, which is what
   * makes that second attempt safe. Blobs are not touched: see `prune`.
   */
  async applyCompaction(plan: CompactionPlan): Promise<boolean> {
    const byStamp = await this.#objectsByStamp(plan.sourceKey);
    const { through } = plan;
    const now =
      through === null
        ? []
        : [...byStamp.keys()].filter((stamp) => stamp <= through).sort(byCodeUnit);
    if (now.length !== plan.examined.length || now.some((s, i) => s !== plan.examined[i])) {
      return false;
    }
    for (const { stamp, sha256 } of plan.remove) {
      await this.#store.delete(LakeStore.journalKey(plan.stream, stamp, sha256));
      for (const obj of byStamp.get(stamp) ?? []) {
        await this.#store.delete(obj);
      }
    }
    return true;
  }

  // -- purge ----------------------------------------------------------------

  /**
   * Delete these blobs, having first written down that it is about to. ADR 0161.
   *
   * THE CALLER DECIDES, AND MUST HAVE ASKED EVERY HOLDER. A blob is shared by content: every
   * observation at every key -- any source, any tenant -- whose bytes hash to a digest names the
   * same `_blobs/` object. This store does not know which of those observations still need their
   * bytes, and cannot: that is a question about documents and extraction, which live in Postgres.
   * So the caller names only digests no holder of which still needs them, and this deletes
   * exactly those.
   *
   * MANIFESTS AND JOURNAL POINTERS STAY. They are what says an observation happened, they are
   * tiny, and `put` decides `unchanged` from the newest manifest at a key -- so a file landed
   * again with the same bytes is still `unchanged`, writes nothing, and is not stored again. The
   * same bytes landed at ANOTHER key find no blob and write it afresh, which is the one way a
   * purged blob comes back, and is right: that document has not been read yet. A read of an
   * observation whose blob is gone raises `BlobAbsent` rather than a bare not-found.
   *
   * REPORTED BEFORE IT DELETES, as compaction is (`raw-lake.md`: never prune silently): one
   * `_reports/blob-purge/` object naming every digest and the caller's `context` -- which run, or
   * which operator -- and only then the deletes. A purge cut off half way has still said what it
   * set out to remove; a digest it reached is `deleted`, and one a second attempt finds already
   * gone is `absent`. Deleting an absent object is not an error, which is what makes that second
   * attempt safe.
   */
  async purgeBlobs(
    digests: readonly string[],
    context: Readonly<Record<string, unknown>>,
  ): Promise<BlobPurge> {
    for (const digest of digests) {
      if (!DIGEST.test(digest)) {
        throw new RangeError(`not a sha256 digest: ${JSON.stringify(digest)}`);
      }
    }
    const unique = [...new Set(digests)];
    const report = await this.report(PURGE_REPORT_KIND, { ...context, digests: unique });
    const held: boolean[] = Array.from({ length: unique.length }, () => false);
    // One iterator shared by every lane: each `next()` hands the next digest to whichever asks.
    const queue = unique.entries();
    const lane = async (): Promise<void> => {
      for (const [index, digest] of queue) {
        const key = LakeStore.blobKey(digest);
        held[index] = await this.#store.exists(key);
        await this.#store.delete(key);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PURGE_LANES, unique.length) }, lane));
    return {
      report,
      deleted: unique.filter((_, i) => held[i] === true),
      absent: unique.filter((_, i) => held[i] !== true),
    };
  }

  /**
   * Keep what the store has to say about itself, create-only, and return where it went.
   *
   * In the lake rather than in Postgres because what it records -- which observations left the
   * archive -- must be as durable as the archive: everything in Postgres is a projection that
   * may be dropped and rebuilt, and this could not be rebuilt from anything.
   */
  async report(kind: string, body: unknown): Promise<string> {
    const key = reportKeyOf(kind, this.#stamps.next());
    if (await this.#store.exists(key)) {
      throw new ObjectExists(`refusing to overwrite an existing report at ${key}`);
    }
    await this.#store.put(key, encoder.encode(JSON.stringify(body, null, 2)));
    return key;
  }
}
