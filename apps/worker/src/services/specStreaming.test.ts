/**
 * A spec run lands what it reads as it reads it, rather than buffering the entity first.
 *
 * `readEntity` has always been an async generator. `ingestEntity` used to gather everything
 * it streamed into one array and land it at the end, which is the shape that reached the
 * worker's 1 GiB cgroup limit on 2026-09-21 and lost all 76 minutes of a Gmail run. It now
 * feeds a record sink, which holds one chunk and projects each one.
 *
 * The pair below is the only way to observe that from outside, and it is also the promise the
 * change was made for:
 *
 * - **a read that dies partway leaves its completed chunks behind.** Under the old shape the
 *   array died with the process and `raw.records` was empty, so the next run re-fetched
 *   everything -- the loss this whole change exists to stop. Under the new one a crash costs
 *   one chunk.
 * - **a read that completes lands every record**, across more chunks than one, which is what
 *   proves the first test is measuring streaming and not a truncated read. It also pins the
 *   explicit `read` counter that replaced `batch.length`: a count taken from an array that no
 *   longer exists would report the last chunk, or zero, and a run reporting the wrong number
 *   is one nobody can act on.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryFetcher } from "@undercroft/connector-runtime/testing";
import { createStampSource, TestClock } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { CHUNK } from "./landing.ts";
import { runIngest } from "./ingest.ts";

const BASE = "https://stream.test";

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
`;

let lake: LakeStore;
let db: TestDatabase;
let specsDir: string;

beforeEach(async () => {
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
  await db.exec("CREATE TABLE raw.records_demo PARTITION OF raw.records FOR VALUES IN ('demo')");
  specsDir = mkdtempSync(join(tmpdir(), "undercroft-specs-"));
  writeFileSync(join(specsDir, "demo.yaml"), SPEC);
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

/** `count` records, ids numbered from `from`, so a page is bigger than one chunk. */
function page(from: number, count: number): { id: string }[] {
  return Array.from({ length: count }, (_unused, index) => ({ id: `r${from + index}` }));
}

async function landedCount(): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM raw.records WHERE source = 'demo'",
  );
  return Number.parseInt(rows[0]?.n ?? "0", 10);
}

function ingest(fetcher: InMemoryFetcher): ReturnType<typeof runIngest> {
  return runIngest({ lake, exec: db, specsDir, fetcher }, { source: "demo", tenantId: "CASE-1" });
}

describe("a crash costs a chunk, not the run", () => {
  it("the chunks that completed are in raw.records after the read dies", async () => {
    // Page two is never recorded, so the fetcher refuses it -- an upstream fault, arriving
    // after a full chunk has already gone down.
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: page(1, CHUNK), paging: { next: { link: `${BASE}/things?page=2` } } },
    });

    await expect(ingest(fetcher)).rejects.toThrow();

    expect(await landedCount()).toBe(CHUNK);
  });

  it("a read that completes lands every record, across more chunks than one", async () => {
    const fetcher = new InMemoryFetcher()
      .on("GET", `${BASE}/things`, {
        body: { results: page(1, CHUNK), paging: { next: { link: `${BASE}/things?page=2` } } },
      })
      .on("GET", `${BASE}/things?page=2`, { body: { results: page(CHUNK + 1, 5), paging: {} } });

    const result = await ingest(fetcher);

    expect(result.entities[0]?.landed).toBe(CHUNK + 5);
    expect(result.entities[0]?.loadedCreated).toBe(CHUNK + 5);
    expect(await landedCount()).toBe(CHUNK + 5);
  });
});
