/**
 * A record the source stops listing is marked removed -- but only by a run that listed it all.
 *
 * Driven through `runIngest`, the scheduler's own door, over a spec shaped as `hubspot.yaml`
 * declares its objects: a client-filtered list declared `removedWhen: absent`, and a relation
 * keyed by the parent's id declared `removedWhen: parent-removed`. PGlite runs every statement as
 * `undercroft_worker`. ADR 0071.
 *
 * The pair that carries the weight is the complete run that marks a missing record against the
 * cut-off run that marks nothing: a partial listing would report every record it had not
 * reached as deleted. The quiet half of the first test matters as much -- a record the client
 * filter SKIPS as unchanged is still listed, and leaving it out would report an unchanged
 * portal deleted on its second run, which is the trap Drive's `seenIds` fell into first.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryFetcher } from "@undercroft/connector-runtime/testing";
import { createStampSource, TestClock } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { runIngest } from "./ingest.ts";
import type { RunDeps } from "./runTypes.ts";

const BASE = "https://crm.test";
const DEALS = `${BASE}/deals`;
const LINKS = `${BASE}/links/batch/read`;

const SPEC = `
apiVersion: undercroft.dev/v1
kind: Connector
id: crm
displayName: CRM
baseUrl: ${BASE}
auth: { kind: none }
defaults:
  pagination: { kind: json-link, nextPath: paging.next.link }
entities:
  - name: deals
    request: { kind: list, path: /deals }
    envelopePath: results
    idPath: id
    incremental: { strategy: client-filter, sourcePath: changedAt, format: epoch-millis }
    removedWhen: absent
  - name: links
    request:
      kind: batch-from
      entity: deals
      idPath: id
      path: /links/batch/read
      bodyTemplate: hubspot-batch-inputs
    envelopePath: results
    idPath: from.id
    pagination: { kind: none }
    guards: { failOnEmpty: false }
    removedWhen: parent-removed
`;

/** A deal as the list names it. `changedAt` is what the client filter compares. */
function deal(id: string, changedAt: string): { id: string; changedAt: string } {
  return { id, changedAt };
}

/**
 * One page of deals, and a link for each. The link read answers the same whatever it is asked
 * about, which a relation read accepts; only which deals are LISTED is under test here.
 */
function source(deals: readonly { id: string; changedAt: string }[]): InMemoryFetcher {
  return new InMemoryFetcher()
    .on("GET", DEALS, { body: { results: deals, paging: {} } })
    .on("POST", LINKS, {
      body: { results: deals.map((d) => ({ from: { id: d.id }, to: [{ toObjectId: "c1" }] })) },
    });
}

let lake: LakeStore;
let db: TestDatabase;
let specsDir: string;

beforeEach(async () => {
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
  await db.exec("CREATE TABLE raw.records_crm PARTITION OF raw.records FOR VALUES IN ('crm')");
  specsDir = mkdtempSync(join(tmpdir(), "undercroft-specs-"));
  writeFileSync(join(specsDir, "crm.yaml"), SPEC);
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

function ingest(deps: Partial<RunDeps>): ReturnType<typeof runIngest> {
  return runIngest({ lake, exec: db, specsDir, ...deps }, { source: "crm", tenantId: "CASE-1" });
}

/** Every row this source holds, as `entity/id`, split by whether it is marked removed. */
async function removed(): Promise<{ removed: string[]; live: string[] }> {
  const { rows } = await db.query<{ key: string; gone: boolean }>(
    `SELECT entity || '/' || source_record_id AS key, deleted_at IS NOT NULL AS gone
       FROM raw.records WHERE source = 'crm' ORDER BY entity, source_record_id`,
  );
  return {
    removed: rows.filter((r) => r.gone).map((r) => r.key),
    live: rows.filter((r) => !r.gone).map((r) => r.key),
  };
}

/** Held before each case: three deals, each with its link. `d1` is the oldest. */
async function seed(): Promise<void> {
  await ingest({ fetcher: source([deal("d1", "100"), deal("d2", "500"), deal("d3", "900")]) });
}

describe("a complete run decides what the source no longer holds", () => {
  it("marks a deal it did not list removed, with its link, and nothing it did list", async () => {
    await seed();

    // d2 is gone. d1 is listed but below the watermark, so the filter does not land it: it must
    // still count as listed.
    const result = await ingest({ fetcher: source([deal("d1", "100"), deal("d3", "900")]) });

    expect(result.entities.find((e) => e.entity === "deals")?.landed).toBe(1);
    expect(await removed()).toEqual({
      removed: ["deals/d2", "links/d2"],
      live: ["deals/d1", "deals/d3", "links/d1", "links/d3"],
    });
    // Kept, not erased: the removed row still carries its last payload, and it was marked
    // removed at a time inside the run that noticed.
    const { rows } = await db.query<{ id: string; within: boolean }>(
      `SELECT r.payload->>'id' AS id, r.deleted_at BETWEEN run.started_at AND run.ended_at AS within
         FROM raw.records r, ops.run run
        WHERE r.entity = 'deals' AND r.source_record_id = 'd2' AND run.id = $1`,
      [result.runId],
    );
    expect(rows).toEqual([{ id: "d2", within: true }]);
  });

  it("shows a deal live again, link included, once it is listed again unchanged", async () => {
    await seed();
    await ingest({ fetcher: source([deal("d1", "100"), deal("d3", "900")]) });

    // Restored from the recycle bin as it was: below the watermark, so nothing re-lands it.
    await ingest({ fetcher: source([deal("d1", "100"), deal("d2", "500"), deal("d3", "900")]) });

    expect((await removed()).removed).toEqual([]);
  });
});

describe("a run that did not list everything decides nothing", () => {
  it("marks nothing removed when the read fails partway", async () => {
    await seed();
    // Page two is not recorded, so the fetcher refuses it: an upstream fault mid-list.
    const fetcher = new InMemoryFetcher().on("GET", DEALS, {
      body: { results: [deal("d3", "900")], paging: { next: { link: `${DEALS}?after=d3` } } },
    });

    await expect(ingest({ fetcher })).rejects.toThrow();

    expect((await removed()).removed).toEqual([]);
  });

  it("marks nothing removed when the run is stopped partway", async () => {
    await seed();
    const recorded = source([deal("d3", "900")]);
    const stop = new AbortController();
    // Not a mock: every request still goes to the recording. The stop arrives with the list.
    const fetcher: RunDeps["fetcher"] = {
      send: (request) => {
        stop.abort();
        return recorded.send(request);
      },
    };

    await expect(ingest({ fetcher, stop: stop.signal })).rejects.toThrow();

    expect((await removed()).removed).toEqual([]);
  });
});
