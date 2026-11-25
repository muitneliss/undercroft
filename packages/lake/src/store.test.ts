import { beforeEach, describe, expect, test as it } from "bun:test";
import { byCodeUnit, createStampSource, TestClock } from "@undercroft/core";
import { InMemoryObjectStore } from "./memory.ts";
import { BlobAbsent, type JournalEntry, LakeStore, ObjectExists } from "./store.ts";

/**
 * The journal is yielded, so a suite that wants to assert on the whole of it says so.
 * Every expectation below is the one it always was; only the taking is spelled out.
 */
async function collect(entries: AsyncIterable<JournalEntry>): Promise<JournalEntry[]> {
  const all: JournalEntry[] = [];
  for await (const entry of entries) {
    all.push(entry);
  }
  return all;
}

const encoder = new TextEncoder();
function bytes(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text);
}

let backing: InMemoryObjectStore;
let clock: TestClock;

function lake(retention?: number): LakeStore {
  return new LakeStore(backing, {
    stamps: createStampSource(clock),
    ...(retention === undefined ? {} : { retention }),
  });
}

beforeEach(() => {
  backing = new InMemoryObjectStore();
  clock = new TestClock();
});

describe("create-only", () => {
  it("the manifest for an observation is never overwritten", async () => {
    // The monotonic stamp source keeps a real collision from happening, so one is staged:
    // a second source on an identical clock names the stamp the store is about to use, and
    // an observation is planted there first. The quiet side is every other put in this file.
    const stamp = createStampSource(new TestClock()).next();
    const manifestKey = `hubspot/deals/1/${stamp}/manifest.json`;
    const planted = bytes('{"sha256":"planted"}');
    await backing.put(manifestKey, planted);

    await expect(lake().put("hubspot/deals/1", bytes("a"), { runId: "r1" })).rejects.toBeInstanceOf(
      ObjectExists,
    );
    expect(await backing.get(manifestKey)).toEqual(planted);
  });
});

describe("idempotent by content", () => {
  it("re-storing identical bytes reports unchanged and writes nothing", async () => {
    const store = lake();
    await store.put("hubspot/deals/1", bytes("same"), { runId: "r1" });
    const sizeAfterFirst = backing.size;

    const second = await store.put("hubspot/deals/1", bytes("same"), { runId: "r2" });
    expect(second.status).toBe("unchanged");
    expect(second.versionKey).toBe("");
    expect(backing.size).toBe(sizeAfterFirst);
    expect((await store.versions("hubspot/deals/1")).length).toBe(1);
  });

  it("a changed payload creates one new observation and reuses shared blobs", async () => {
    const store = lake();
    await store.put("hubspot/deals/1", bytes("v1"), { runId: "r1" });
    const blobsAfterFirst = (await backing.list("_blobs/")).length;

    const changed = await store.put("hubspot/deals/1", bytes("v2"), { runId: "r2" });
    expect(changed.status).toBe("created");
    expect((await backing.list("_blobs/")).length).toBe(blobsAfterFirst + 1);
  });

  it("the same bytes at two keys are stored once", async () => {
    // The whole reason content addressing is the default: one document in fifty mailboxes
    // is one blob, not fifty.
    const store = lake();
    await store.put("gmail/a/attachments/x", bytes("same-pdf"), { runId: "r1" });
    await store.put("gmail/b/attachments/y", bytes("same-pdf"), { runId: "r1" });
    expect((await backing.list("_blobs/")).length).toBe(1);
  });
});

describe("reading verifies the digest", () => {
  it("reads back the newest observation", async () => {
    const store = lake();
    await store.put("hubspot/deals/1", bytes("v1"), { runId: "r1" });
    await store.put("hubspot/deals/1", bytes("v2"), { runId: "r2" });
    expect(new TextDecoder().decode(await store.read("hubspot/deals/1"))).toBe("v2");
  });

  it("a corrupted blob raises rather than returning suspect bytes", async () => {
    const store = lake();
    const put = await store.put("hubspot/deals/1", bytes("real"), { runId: "r1" });
    // Tamper with the blob behind the store's back.
    await backing.put(put.blobKey, bytes("tampered"));
    await expect(store.read("hubspot/deals/1")).rejects.toBeInstanceOf(ObjectExists);
  });

  it("reading a key with no observations raises", async () => {
    await expect(lake().read("hubspot/deals/absent")).rejects.toThrow(/no observations/u);
  });
});

describe("source key shape is enforced", () => {
  it.each([
    ["an empty key", ""],
    ["a traversal", "hubspot/../secrets/1"],
    ["a reserved blob prefix", "_blobs/aa/deadbeef"],
    ["a reserved journal prefix", "_journal/x"],
    ["a container key (too shallow)", "hubspot"],
  ])("rejects %s", async (_label, key) => {
    // A container key would make retention prune sibling entities; the others would
    // escape the store's own layout. All are refused at the single entry point.
    await expect(lake().put(key, bytes("x"), { runId: "r1" })).rejects.toBeInstanceOf(RangeError);
  });

  it("accepts a well-formed leaf key", async () => {
    const result = await lake().put("xero/invoices/INV-001", bytes("x"), { runId: "r1" });
    expect(result.status).toBe("created");
  });
});

describe("retention is bounded and reported", () => {
  it("keeps everything by default", async () => {
    const store = lake();
    for (const v of ["a", "b", "c", "d"]) {
      await store.put("hubspot/deals/1", bytes(v), { runId: "r" });
    }
    expect((await store.versions("hubspot/deals/1")).length).toBe(4);
  });

  it("prune trims to the limit oldest-first and names what it removed", async () => {
    const store = lake(2);
    const stamps: string[] = [];
    const pruned: (readonly string[])[] = [];
    for (const v of ["a", "b", "c"]) {
      const r = await store.put("hubspot/deals/1", bytes(v), { runId: "r" });
      stamps.push(r.versionKey.split("/").at(-1)!);
      pruned.push(r.pruned);
    }
    const remaining = await store.versions("hubspot/deals/1");
    expect(remaining.length).toBe(2);
    // The two newest survive; the oldest is gone.
    expect(remaining).not.toContain(stamps[0]!);
    expect(remaining).toContain(stamps[2]!);
    // And the put that pushed it out says so: silent pruning of a durable store is
    // indistinguishable from data loss.
    expect(pruned).toEqual([[], [], [stamps[0]!]]);
  });

  it("a retention below 1 is refused", () => {
    expect(() => new LakeStore(backing, { retention: 0 })).toThrow(/at least 1/u);
  });

  it("blobs are never pruned, because another key may reference them", async () => {
    const store = lake(1);
    await store.put("hubspot/deals/1", bytes("a"), { runId: "r" });
    await store.put("hubspot/deals/1", bytes("b"), { runId: "r" });
    // One observation pruned, but both blobs remain -- GC is a separate deliberate step.
    expect((await backing.list("_blobs/")).length).toBe(2);
  });
});

describe("the journal is a per-stream cursor", () => {
  it("records observations for a stream in stamp order", async () => {
    const store = lake();
    const stream = "records/hubspot/CASE-1/deals";
    await store.put("records/hubspot/CASE-1/deals/1", bytes("d1"), { runId: "r1", stream });
    await store.put("records/hubspot/CASE-1/deals/2", bytes("d2"), { runId: "r1", stream });

    const entries = await collect(store.journalSince(stream, null));
    expect(entries.map((e) => e.sourceKey)).toEqual([
      "records/hubspot/CASE-1/deals/1",
      "records/hubspot/CASE-1/deals/2",
    ]);
  });

  it("returns only entries after the cursor", async () => {
    const store = lake();
    const stream = "records/hubspot/CASE-1/deals";
    const first = await store.put("records/hubspot/CASE-1/deals/1", bytes("d1"), {
      runId: "r1",
      stream,
    });
    await store.put("records/hubspot/CASE-1/deals/2", bytes("d2"), { runId: "r1", stream });

    const firstStamp = first.versionKey.split("/").at(-1)!;
    const after = await collect(store.journalSince(stream, firstStamp));
    expect(after.map((e) => e.sourceKey)).toEqual(["records/hubspot/CASE-1/deals/2"]);
  });

  it("unchanged re-observations add no journal entry", async () => {
    const store = lake();
    const stream = "records/hubspot/CASE-1/deals";
    await store.put("records/hubspot/CASE-1/deals/1", bytes("d1"), { runId: "r1", stream });
    await store.put("records/hubspot/CASE-1/deals/1", bytes("d1"), { runId: "r2", stream });
    expect((await collect(store.journalSince(stream, null))).length).toBe(1);
  });

  it("streams do not see each other's entries", async () => {
    const store = lake();
    await store.put("records/hubspot/CASE-1/deals/1", bytes("d"), {
      runId: "r1",
      stream: "records/hubspot/CASE-1/deals",
    });
    await store.put("records/xero/CASE-1/invoices/1", bytes("i"), {
      runId: "r1",
      stream: "records/xero/CASE-1/invoices",
    });
    expect((await collect(store.journalSince("records/hubspot/CASE-1/deals", null))).length).toBe(
      1,
    );
    expect((await collect(store.journalSince("records/xero/CASE-1/invoices", null))).length).toBe(
      1,
    );
  });

  it("from a cursor, every later entry is returned and no earlier one", async () => {
    // The firing side of the scan starting at the cursor. Built with entries on BOTH sides
    // of it on purpose: a `startAfter` that narrowed by one key too many would drop the
    // entry just past the cursor, and a fixture whose cursor sits at the end could not tell.
    const store = lake();
    const stream = "records/hubspot/CASE-1/deals";
    const stamps: string[] = [];
    for (const n of [1, 2, 3, 4, 5]) {
      const put = await store.put(`${stream}/${n}`, bytes(`d${n}`), { runId: "r1", stream });
      stamps.push(put.versionKey.split("/").at(-1)!);
    }

    const after = await collect(store.journalSince(stream, stamps[1]!));

    expect(after.map((e) => e.sourceKey)).toEqual([`${stream}/3`, `${stream}/4`, `${stream}/5`]);
  });

  it("from no cursor, the whole journal is returned", async () => {
    // The quiet side, over the same fixture: narrowing the scan must not narrow the answer
    // when there is no cursor to narrow it to. A first run reads everything, still.
    const store = lake();
    const stream = "records/hubspot/CASE-1/deals";
    for (const n of [1, 2, 3, 4, 5]) {
      await store.put(`${stream}/${n}`, bytes(`d${n}`), { runId: "r1", stream });
    }

    const all = await collect(store.journalSince(stream, null));

    expect(all.map((e) => e.sourceKey)).toEqual([
      `${stream}/1`,
      `${stream}/2`,
      `${stream}/3`,
      `${stream}/4`,
      `${stream}/5`,
    ]);
  });
});

describe("an observation is read in one call", () => {
  it("names its bytes and its manifest together", async () => {
    const store = lake();
    const put = await store.put("hubspot/deals/1", bytes("v1"), { runId: "r1" });
    const stamp = put.versionKey.split("/").at(-1)!;

    const observation = await store.observation("hubspot/deals/1", stamp);

    expect(new TextDecoder().decode(observation.bytes)).toBe("v1");
    expect(observation.manifest).toMatchObject({ runId: "r1", sha256: put.sha256 });
  });

  it("a named observation is read without listing the key", async () => {
    // The firing side of the round-trip fix. A caller that already knows WHICH observation
    // it wants -- the loader, holding a journal entry that names the stamp -- used to pay
    // for a LIST per record anyway, and then discard it. 7,786 records is 7,786 of them.
    const store = lake();
    const put = await store.put("hubspot/deals/1", bytes("v1"), { runId: "r1" });
    const stamp = put.versionKey.split("/").at(-1)!;

    const before = backing.calls.list;
    await store.observation("hubspot/deals/1", stamp);
    await store.read("hubspot/deals/1", stamp);

    expect(backing.calls.list - before).toBe(0);
  });

  it("an unnamed one still lists, because finding the newest is what a listing is for", async () => {
    // The quiet side: the LIST was not removed, it was made conditional on the caller not
    // knowing. `read` with no stamp has no other way to learn which observation is newest.
    const store = lake();
    await store.put("hubspot/deals/1", bytes("v1"), { runId: "r1" });

    const before = backing.calls.list;
    await store.read("hubspot/deals/1");

    expect(backing.calls.list - before).toBeGreaterThan(0);
  });

  it("a corrupted blob raises through observation too", async () => {
    // The digest check belongs to the read, not to one spelling of it: a second door into
    // the same bytes that skipped it would be a way to get suspect bytes downstream.
    const store = lake();
    const put = await store.put("hubspot/deals/1", bytes("v1"), { runId: "r1" });
    const stamp = put.versionKey.split("/").at(-1)!;
    await backing.put(put.blobKey, bytes("tampered"));

    await expect(store.observation("hubspot/deals/1", stamp)).rejects.toBeInstanceOf(ObjectExists);
  });
});

describe("compaction", () => {
  // Two payloads are "the same record" when their letters are, in any order -- a stand-in for
  // a spec's unordered arrays, which the store is handed and never told about (ADR 0160).
  function sameLetters(data: Uint8Array): string {
    return [...new TextDecoder().decode(data)].toSorted(byCodeUnit).join("");
  }
  const STREAM = "records/hubspot/CASE-0042/links";
  const KEY = `${STREAM}/7`;

  /** A history that flip-flops, changes for real, then flip-flops again: ab ba ab xy yx ba. */
  async function history(store: LakeStore): Promise<string[]> {
    const stamps: string[] = [];
    for (const text of ["ab", "ba", "ab", "xy", "yx", "ba"]) {
      const put = await store.put(KEY, bytes(text), { runId: "r1", stream: STREAM });
      stamps.push(put.versionKey.split("/").at(-1)!);
    }
    return stamps;
  }

  it("keeps the first of each run of equivalent payloads and the newest, and names the rest", async () => {
    const store = lake();
    const s = await history(store);

    const plan = await store.planCompaction(STREAM, KEY, sameLetters, s.at(-1)!);
    expect(plan.remove.map((r) => r.stamp)).toEqual([s[1]!, s[2]!, s[4]!]);
    expect(await store.applyCompaction(plan)).toBe(true);

    // `xy` was a real change and survives; `ba`, the newest, survives though it repeats `ab`.
    expect(await store.versions(KEY)).toEqual([s[0]!, s[3]!, s[5]!]);
    expect(new TextDecoder().decode(await store.read(KEY))).toBe("ba");

    // A rebuild of raw.records replays the journal from the start: every pointer it meets
    // names an observation that is still there.
    const replayed = await collect(store.journalSince(STREAM, null));
    expect(replayed.map((e) => e.stamp)).toEqual([s[0]!, s[3]!, s[5]!]);
    for (const entry of replayed) {
      await store.observation(entry.sourceKey, entry.stamp);
    }
  });

  it("touches nothing the loader has not passed", async () => {
    const store = lake();
    const s = await history(store);

    // The loader has projected up to `xy`: that is the last observation considered, so it is
    // kept, and `yx` and `ba` after it are not even looked at.
    const plan = await store.planCompaction(STREAM, KEY, sameLetters, s[3]!);
    expect(plan.remove.map((r) => r.stamp)).toEqual([s[1]!, s[2]!]);
    await store.applyCompaction(plan);
    expect(await store.versions(KEY)).toEqual([s[0]!, s[3]!, s[4]!, s[5]!]);

    // A stream never loaded has no cursor, and nothing in it is considered.
    expect((await store.planCompaction(STREAM, KEY, sameLetters, null)).remove).toEqual([]);
  });

  it("leaves a key that moved between plan and apply for the next run", async () => {
    const store = lake();
    const s = await history(store);
    const stale = await store.planCompaction(STREAM, KEY, sameLetters, s.at(-1)!);
    await store.applyCompaction(await store.planCompaction(STREAM, KEY, sameLetters, s.at(-1)!));

    // The reading `stale` was made on is gone; it deletes nothing rather than act on it.
    const deletes = backing.calls.delete;
    expect(await store.applyCompaction(stale)).toBe(false);
    expect(backing.calls.delete).toBe(deletes);
  });
});

describe("purging a blob (ADR 0161)", () => {
  const KEY = "documents/drive/CASE-0042/f1";

  it("deletes the bytes, keeps the manifest, and says so before it deletes", async () => {
    const store = lake();
    const put = await store.put(KEY, bytes("%PDF"), { runId: "r1", extra: { filename: "a.pdf" } });
    const stamp = put.versionKey.split("/").at(-1)!;

    const purge = await store.purgeBlobs([put.sha256], { runId: "r2" });

    expect(purge).toMatchObject({ deleted: [put.sha256], absent: [] });
    expect(await backing.exists(put.blobKey)).toBe(false);
    // The observation is still traceable: its manifest names the file and the digest.
    expect(await store.manifest(KEY, stamp)).toMatchObject({
      sha256: put.sha256,
      filename: "a.pdf",
    });
    const report = JSON.parse(new TextDecoder().decode(await backing.get(purge.report)));
    expect(report).toEqual({ runId: "r2", digests: [put.sha256] });
    // A reader is told the bytes are gone, not that the store is broken.
    await expect(store.read(KEY)).rejects.toBeInstanceOf(BlobAbsent);
  });

  it("a second purge of a digest reports it absent, and nothing unnamed is deleted", async () => {
    const store = lake();
    const gone = await store.put(KEY, bytes("one"), { runId: "r1" });
    const kept = await store.put("documents/drive/CASE-0042/f2", bytes("two"), { runId: "r1" });
    await store.purgeBlobs([gone.sha256], { runId: "r2" });

    expect(await store.purgeBlobs([gone.sha256], { runId: "r3" })).toMatchObject({
      deleted: [],
      absent: [gone.sha256],
    });
    expect(await backing.exists(kept.blobKey)).toBe(true);
    await expect(store.purgeBlobs(["_journal/x"], { runId: "r4" })).rejects.toThrow(RangeError);
  });

  it("the same bytes at the same key write nothing; at another key they are stored afresh", async () => {
    const store = lake();
    const first = await store.put(KEY, bytes("%PDF"), { runId: "r1" });
    await store.purgeBlobs([first.sha256], { runId: "r2" });

    // Unchanged is decided from the manifest, so a file landed again unchanged stays purged.
    expect((await store.put(KEY, bytes("%PDF"), { runId: "r3" })).status).toBe("unchanged");
    expect(await backing.exists(first.blobKey)).toBe(false);

    // Another document holding those bytes has not been read yet, so its landing brings them back.
    await store.put("documents/gmail/CASE-0042/m1:1", bytes("%PDF"), { runId: "r4" });
    expect(new TextDecoder().decode(await store.read("documents/gmail/CASE-0042/m1:1"))).toBe(
      "%PDF",
    );
  });
});
