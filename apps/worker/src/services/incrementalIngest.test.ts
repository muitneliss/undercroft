/**
 * The cursor a spec run reads from and writes back: `raw.sync_cursor`, end to end.
 *
 * Driven through `runIngest`, the same door the scheduler uses, over a real
 * `InMemoryFetcher` -- which refuses an unmodelled request, so "the second run asked for
 * less" is proved by a route recorded only WITH the watermark. PGlite runs every statement
 * as `undercroft_worker`, so the new table's grant is checked here rather than at 02:00.
 *
 * The pair that carries the weight is advance-on-completion against no-advance-on-failure. A
 * watermark that moved past a read which died halfway would ask the next run for records
 * after a mark that records below it never reached -- and on a source that does not order its
 * pages by the incremental field, which is most of them, those are gone from the one layer
 * that cannot be recomputed. Nothing sets a flag to prevent that; the cursor write simply
 * sits after the loop, so a throw skips it.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryFetcher } from "@undercroft/connector-runtime/testing";
import { createStampSource, TestClock } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { readSyncCursor, writeSyncCursor } from "../repos/syncCursor.ts";
import { runIngest } from "./ingest.ts";

const BASE = "https://demo.test";
const STREAM = { source: "demo", tenantId: "CASE-1", entity: "things" } as const;

// `auth: none`, so the run needs no connection and no sealed credential: what is under test
// is the cursor, and a token would be a second harness to keep working.
const SPEC = `
apiVersion: undercroft.dev/v1
kind: Connector
id: demo
displayName: Demo
baseUrl: ${BASE}
auth: { kind: none }
defaults:
  pagination: { kind: json-link, nextPath: paging.next.link }
entities:
  - name: things
    request: { kind: list, path: /things }
    envelopePath: results
    idPath: id
    updatedAtPath: updatedAt
    incremental:
      strategy: query-param
      param: updatedAfter
      sourcePath: changedAt
      format: epoch-millis
`;

let lake: LakeStore;
let db: TestDatabase;
let specsDir: string;

beforeEach(async () => {
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
  await db.exec("CREATE TABLE raw.records_demo PARTITION OF raw.records FOR VALUES IN ('demo')");
  specsDir = mkdtempSync(join(tmpdir(), "undercroft-specs-"));
  writeFileSync(join(specsDir, "demo.yaml"), SPEC);
  // Seeded as the superuser; from here on every statement runs as the worker does.
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

function ingest(fetcher: InMemoryFetcher): ReturnType<typeof runIngest> {
  return runIngest({ lake, exec: db, specsDir, fetcher }, { source: "demo", tenantId: "CASE-1" });
}

describe("a watermark advances only by getting to the end", () => {
  it("advances to the highest value the entity carried when the read completes", async () => {
    // Highest, not last: the page is deliberately out of order, because a source is not
    // obliged to sort by the field it is filtered on and a watermark taken from the final
    // record of an unordered read skips everything below it forever.
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: {
        results: [
          { id: "1", changedAt: "400" },
          { id: "2", changedAt: "900" },
          { id: "3", changedAt: "700" },
        ],
        paging: {},
      },
    });

    await ingest(fetcher);

    expect(await readSyncCursor(db, STREAM, "epoch-millis")).toBe("900");
  });

  it("does not advance when the entity throws partway", async () => {
    // Page two is not recorded, so the fetcher refuses it -- the same shape as an upstream
    // fault or a token that expired mid-read.
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: {
        results: [{ id: "1", changedAt: "900" }],
        paging: { next: { link: `${BASE}/things?page=2` } },
      },
    });

    await expect(ingest(fetcher)).rejects.toThrow();

    expect(await readSyncCursor(db, STREAM, "epoch-millis")).toBeNull();
  });

  it("stays where it was when an incremental read finds nothing new", async () => {
    await writeSyncCursor(db, STREAM, { watermark: "900", format: "epoch-millis" });
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things?updatedAfter=900`, {
      body: { results: [], paging: {} },
    });

    // And the run is green: `failOnEmpty` is relaxed because a watermark was sent.
    const result = await ingest(fetcher);

    expect(result.entities[0]?.landed).toBe(0);
    expect(await readSyncCursor(db, STREAM, "epoch-millis")).toBe("900");
  });
});

describe("the second run asks the source for less", () => {
  it("sends the stored watermark and lands only what came back", async () => {
    const first = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "1", changedAt: "400" }], paging: {} },
    });
    await ingest(first);

    // Recorded ONLY at the URL carrying the watermark: a second run that forgot it would
    // fail against the fetcher rather than quietly re-reading the whole source.
    const second = new InMemoryFetcher().on("GET", `${BASE}/things?updatedAfter=400`, {
      body: { results: [{ id: "2", changedAt: "800" }], paging: {} },
    });
    const result = await ingest(second);

    expect(second.calls.map((call) => call.url)).toEqual([`${BASE}/things?updatedAfter=400`]);
    expect(result.entities[0]?.landed).toBe(1);
    expect(await readSyncCursor(db, STREAM, "epoch-millis")).toBe("800");

    const { rows } = await db.query<{ id: string }>(
      "SELECT source_record_id AS id FROM raw.records WHERE source = 'demo' ORDER BY source_record_id",
    );
    expect(rows.map((r) => r.id)).toEqual(["1", "2"]);
  });
});

describe("a watermark is only ever handed back under the format it was written in", () => {
  it("answers nothing when the spec has changed format under it", async () => {
    // One honest full read, rather than comparing two incompatible renderings of an instant
    // and being silently wrong about which is later. The quiet side -- the same format answers
    // the stored value -- is "stays where it was when an incremental read finds nothing new",
    // which writes this cursor and reads it back through a whole run.
    await writeSyncCursor(db, STREAM, { watermark: "900", format: "epoch-millis" });

    expect(await readSyncCursor(db, STREAM, "iso8601")).toBeNull();
  });
});
