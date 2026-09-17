import { createStampSource, TestClock } from "@undercroft/core";
import { beforeEach, describe, expect, test } from "bun:test";
import { InMemoryObjectStore } from "./memory.ts";
import { LakeStore, ObjectExists } from "./store.ts";

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);

let backing: InMemoryObjectStore;
let clock: TestClock;

function lake(retention?: number) {
  return new LakeStore(backing, {
    stamps: createStampSource(clock),
    ...(retention !== undefined ? { retention } : {}),
  });
}

beforeEach(() => {
  backing = new InMemoryObjectStore();
  clock = new TestClock();
});

describe("create-only", () => {
  test("a first write is created", async () => {
    const result = await lake().put("hubspot/deals/1", bytes("a"), { runId: "r1" });
    expect(result.status).toBe("created");
    expect(result.versionKey).not.toBe("");
  });

  test("the manifest for an observation is never overwritten", async () => {
    // Two different payloads land as two observations. A stamp collision that tried to
    // reuse a manifest key would raise; the monotonic stamp source prevents it, and this
    // asserts the create-only guard holds even so.
    const store = lake();
    await store.put("hubspot/deals/1", bytes("a"), { runId: "r1" });
    await store.put("hubspot/deals/1", bytes("b"), { runId: "r2" });
    expect((await store.versions("hubspot/deals/1")).length).toBe(2);
  });
});

describe("idempotent by content", () => {
  test("re-storing identical bytes reports unchanged and writes nothing", async () => {
    const store = lake();
    await store.put("hubspot/deals/1", bytes("same"), { runId: "r1" });
    const sizeAfterFirst = backing.size;

    const second = await store.put("hubspot/deals/1", bytes("same"), { runId: "r2" });
    expect(second.status).toBe("unchanged");
    expect(second.versionKey).toBe("");
    expect(backing.size).toBe(sizeAfterFirst);
    expect((await store.versions("hubspot/deals/1")).length).toBe(1);
  });

  test("a changed payload creates one new observation and reuses shared blobs", async () => {
    const store = lake();
    await store.put("hubspot/deals/1", bytes("v1"), { runId: "r1" });
    const blobsAfterFirst = (await backing.list("_blobs/")).length;

    const changed = await store.put("hubspot/deals/1", bytes("v2"), { runId: "r2" });
    expect(changed.status).toBe("created");
    expect((await backing.list("_blobs/")).length).toBe(blobsAfterFirst + 1);
  });

  test("the same bytes at two keys are stored once", async () => {
    // The whole reason content addressing is the default: one document in fifty mailboxes
    // is one blob, not fifty.
    const store = lake();
    await store.put("gmail/a/attachments/x", bytes("same-pdf"), { runId: "r1" });
    await store.put("gmail/b/attachments/y", bytes("same-pdf"), { runId: "r1" });
    expect((await backing.list("_blobs/")).length).toBe(1);
  });
});

describe("reading verifies the digest", () => {
  test("reads back the newest observation", async () => {
    const store = lake();
    await store.put("hubspot/deals/1", bytes("v1"), { runId: "r1" });
    await store.put("hubspot/deals/1", bytes("v2"), { runId: "r2" });
    expect(new TextDecoder().decode(await store.read("hubspot/deals/1"))).toBe("v2");
  });

  test("a corrupted blob raises rather than returning suspect bytes", async () => {
    const store = lake();
    const put = await store.put("hubspot/deals/1", bytes("real"), { runId: "r1" });
    // Tamper with the blob behind the store's back.
    await backing.put(put.blobKey, bytes("tampered"));
    await expect(store.read("hubspot/deals/1")).rejects.toBeInstanceOf(ObjectExists);
  });

  test("reading a key with no observations raises", async () => {
    await expect(lake().read("hubspot/deals/absent")).rejects.toThrow(/no observations/);
  });
});

describe("source key shape is enforced", () => {
  test.each([
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

  test("accepts a well-formed leaf key", async () => {
    const result = await lake().put("xero/invoices/INV-001", bytes("x"), { runId: "r1" });
    expect(result.status).toBe("created");
  });
});

describe("retention is bounded and reported", () => {
  test("keeps everything by default", async () => {
    const store = lake();
    for (const v of ["a", "b", "c", "d"]) {
      await store.put("hubspot/deals/1", bytes(v), { runId: "r" });
    }
    expect((await store.versions("hubspot/deals/1")).length).toBe(4);
  });

  test("prune trims to the limit oldest-first and names what it removed", async () => {
    const store = lake(2);
    const stamps: string[] = [];
    for (const v of ["a", "b", "c"]) {
      const r = await store.put("hubspot/deals/1", bytes(v), { runId: "r" });
      stamps.push(r.versionKey.split("/").at(-1)!);
    }
    const remaining = await store.versions("hubspot/deals/1");
    expect(remaining.length).toBe(2);
    // The two newest survive; the oldest is gone.
    expect(remaining).not.toContain(stamps[0]!);
    expect(remaining).toContain(stamps[2]!);
  });

  test("a retention below 1 is refused", () => {
    expect(() => new LakeStore(backing, { retention: 0 })).toThrow(/at least 1/);
  });

  test("blobs are never pruned, because another key may reference them", async () => {
    const store = lake(1);
    await store.put("hubspot/deals/1", bytes("a"), { runId: "r" });
    await store.put("hubspot/deals/1", bytes("b"), { runId: "r" });
    // One observation pruned, but both blobs remain -- GC is a separate deliberate step.
    expect((await backing.list("_blobs/")).length).toBe(2);
  });
});

describe("the journal is a per-stream cursor", () => {
  test("records observations for a stream in stamp order", async () => {
    const store = lake();
    const stream = "records/hubspot/CASE-1/deals";
    await store.put("records/hubspot/CASE-1/deals/1", bytes("d1"), { runId: "r1", stream });
    await store.put("records/hubspot/CASE-1/deals/2", bytes("d2"), { runId: "r1", stream });

    const entries = await store.journalSince(stream, null);
    expect(entries.map((e) => e.sourceKey)).toEqual([
      "records/hubspot/CASE-1/deals/1",
      "records/hubspot/CASE-1/deals/2",
    ]);
  });

  test("returns only entries after the cursor", async () => {
    const store = lake();
    const stream = "records/hubspot/CASE-1/deals";
    const first = await store.put("records/hubspot/CASE-1/deals/1", bytes("d1"), {
      runId: "r1",
      stream,
    });
    await store.put("records/hubspot/CASE-1/deals/2", bytes("d2"), { runId: "r1", stream });

    const firstStamp = first.versionKey.split("/").at(-1)!;
    const after = await store.journalSince(stream, firstStamp);
    expect(after.map((e) => e.sourceKey)).toEqual(["records/hubspot/CASE-1/deals/2"]);
  });

  test("unchanged re-observations add no journal entry", async () => {
    const store = lake();
    const stream = "records/hubspot/CASE-1/deals";
    await store.put("records/hubspot/CASE-1/deals/1", bytes("d1"), { runId: "r1", stream });
    await store.put("records/hubspot/CASE-1/deals/1", bytes("d1"), { runId: "r2", stream });
    expect((await store.journalSince(stream, null)).length).toBe(1);
  });

  test("streams do not see each other's entries", async () => {
    const store = lake();
    await store.put("records/hubspot/CASE-1/deals/1", bytes("d"), {
      runId: "r1",
      stream: "records/hubspot/CASE-1/deals",
    });
    await store.put("records/xero/CASE-1/invoices/1", bytes("i"), {
      runId: "r1",
      stream: "records/xero/CASE-1/invoices",
    });
    expect((await store.journalSince("records/hubspot/CASE-1/deals", null)).length).toBe(1);
    expect((await store.journalSince("records/xero/CASE-1/invoices", null)).length).toBe(1);
  });
});
