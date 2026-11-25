/**
 * Compacting a HubSpot association stream's flip-flop history, end to end: the real spec's
 * `unorderedArrays`, the real loader's cursor, the lake's create-only writer. ADR 0160.
 *
 * The rule itself -- what is kept, the cursor bound, a key that moved -- is pinned beside the
 * store in `packages/lake/src/store.test.ts`. What is pinned here is what only the composition
 * can show: the spec's declaration is the equivalence, a dry run names exactly what a real run
 * removes, and a stream with a run in progress is left alone.
 */

import { streamOf } from "@undercroft/contracts";
import { createStampSource, TestClock } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { join } from "node:path";

import { compactLake } from "./lakeCompaction.ts";
import { loadStreamToRaw } from "./loadToRaw.ts";

const SPECS_DIR = join(import.meta.dir, "..", "..", "..", "..", "specs", "connectors");
const IDENTITY = { source: "hubspot", tenantId: "CASE-0042", entity: "contact_companies" };
const STREAM = streamOf(IDENTITY);
const KEY = `${STREAM}/101`;

/** One link, its two kinds in the order HubSpot happened to send them. */
function link(typeIds: readonly number[]): string {
  const types = typeIds
    .map((id) => `{"category":"HUBSPOT_DEFINED","label":null,"typeId":${id}}`)
    .join(",");
  return `{"from":{"id":"101"},"to":[{"associationTypes":[${types}],"toObjectId":501}]}`;
}

let backing: InMemoryObjectStore;
let lake: LakeStore;
let db: TestDatabase;

beforeEach(async () => {
  backing = new InMemoryObjectStore();
  lake = new LakeStore(backing, { stamps: createStampSource(new TestClock()) });
  db = await createMigratedTestDatabase();
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

/** A, B, A, B, then a real change -- each landed and projected, as a sync would. */
async function flipFlopHistory(): Promise<string[]> {
  const stamps: string[] = [];
  const texts = [link([1, 279]), link([279, 1]), link([1, 279]), link([279, 1]), link([1])];
  for (const text of texts) {
    const put = await lake.put(KEY, new TextEncoder().encode(text), {
      runId: "run-1",
      stream: STREAM,
    });
    stamps.push(put.versionKey.split("/").at(-1)!);
  }
  await loadStreamToRaw(db, lake, IDENTITY);
  return stamps;
}

async function reportAt(key: string): Promise<{ remove: unknown }> {
  return JSON.parse(new TextDecoder().decode(await backing.get(key))) as { remove: unknown };
}

describe("compactLake", () => {
  it("a dry run names exactly what a real run then removes, and removes nothing itself", async () => {
    const s = await flipFlopHistory();
    const deps = { exec: db, lake, specsDir: SPECS_DIR };
    const named = [{ sourceKey: KEY, stamps: [s[1]!, s[2]!, s[3]!] }];

    const dry = await compactLake(deps, { apply: false, tenantId: "CASE-0042" });
    expect(dry.streams.map((x) => [x.stream, x.removed])).toEqual([[STREAM, 3]]);
    expect((await reportAt(dry.streams[0]!.planReport!)).remove).toEqual(named);
    expect(await lake.versions(KEY)).toEqual(s);

    const real = await compactLake(deps, { apply: true, tenantId: "CASE-0042" });
    expect((await reportAt(real.streams[0]!.doneReport!)).remove).toEqual(named);
    // The first sighting and the real change to a single link kind survive.
    expect(await lake.versions(KEY)).toEqual([s[0]!, s[4]!]);

    // Run again, it finds nothing left to do.
    const again = await compactLake(deps, { apply: true, tenantId: "CASE-0042" });
    expect(again.streams[0]?.removed).toBe(0);
  });

  it("leaves a stream alone while a run of its tenant and source is in progress", async () => {
    const s = await flipFlopHistory();
    await db.asSuperuser((tx) =>
      tx.query("INSERT INTO ops.run (id, tenant_id, source, verb) VALUES ($1, $2, $3, $4)", [
        "run-2",
        IDENTITY.tenantId,
        IDENTITY.source,
        "ingest",
      ]),
    );

    const outcome = await compactLake(
      { exec: db, lake, specsDir: SPECS_DIR },
      { apply: true, tenantId: null },
    );
    expect(outcome.streams.map((x) => x.skipped)).toEqual(["run-in-progress"]);
    expect(await lake.versions(KEY)).toEqual(s);
  });
});
