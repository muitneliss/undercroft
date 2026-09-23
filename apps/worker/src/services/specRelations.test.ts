/**
 * A `batch-from` relation still reads against the ids of the entity it names.
 *
 * `runSpecIngest` used to keep EVERY entity's ids in a map until the run ended -- a second
 * copy of the source, growing with it, for the benefit of a relation that in both shipped
 * specs references one entity out of four. It now keeps only the entities some relation
 * actually names, computed from the spec before the first request.
 *
 * That is the kind of narrowing that fails silently: a relation handed an empty id list POSTs
 * nothing, lands nothing, and closes green. So the fires/stays-quiet pair here is "the
 * referenced entity's ids reach the relation" against "an entity nobody references is read
 * and landed exactly as before" -- the second being the whole population the narrowing
 * touches. Asserted over the body the relation actually POSTed, which is observable, rather
 * than over the map, which is not.
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

const BASE = "https://rel.test";

// Three entities: one a relation reads against, one it does not, and the relation itself.
const SPEC = `
apiVersion: undercroft.dev/v1
kind: Connector
id: rel
displayName: Relation
baseUrl: ${BASE}
auth: { kind: none }
entities:
  - name: deals
    request: { kind: list, path: /deals }
    envelopePath: results
    idPath: id
    pagination: { kind: none }
  - name: notes
    request: { kind: list, path: /notes }
    envelopePath: results
    idPath: id
    pagination: { kind: none }
  - name: associations
    request:
      kind: batch-from
      entity: deals
      idPath: id
      chunkSize: 10
      path: /associations/batch/read
      bodyTemplate: hubspot-batch-inputs
    envelopePath: results
    idPath: from.id
    pagination: { kind: none }
`;

let lake: LakeStore;
let db: TestDatabase;
let specsDir: string;

beforeEach(async () => {
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
  await db.exec("CREATE TABLE raw.records_rel PARTITION OF raw.records FOR VALUES IN ('rel')");
  specsDir = mkdtempSync(join(tmpdir(), "undercroft-specs-"));
  writeFileSync(join(specsDir, "rel.yaml"), SPEC);
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

function sources(): InMemoryFetcher {
  return new InMemoryFetcher()
    .on("GET", `${BASE}/deals`, { body: { results: [{ id: "d1" }, { id: "d2" }] } })
    .on("GET", `${BASE}/notes`, { body: { results: [{ id: "n1" }] } })
    .on("POST", `${BASE}/associations/batch/read`, {
      body: { results: [{ from: { id: "d1" } }, { from: { id: "d2" } }] },
    });
}

describe("only the entities a relation names are kept", () => {
  it("the relation POSTs the ids of the entity it references", async () => {
    const fetcher = sources();

    await runIngest({ lake, exec: db, specsDir, fetcher }, { source: "rel", tenantId: "CASE-1" });

    const posted = fetcher.calls.find((call) => call.method === "POST");
    expect(JSON.parse(posted?.body ?? "null")).toEqual({
      inputs: [{ id: "d1" }, { id: "d2" }],
    });
  });

  it("an entity no relation references is read and landed just the same", async () => {
    const result = await runIngest(
      { lake, exec: db, specsDir, fetcher: sources() },
      { source: "rel", tenantId: "CASE-1" },
    );

    expect(result.entities.map((entity) => [entity.entity, entity.landed])).toEqual([
      ["deals", 2],
      ["notes", 1],
      ["associations", 2],
    ]);
    const { rows } = await db.query<{ id: string }>(
      "SELECT source_record_id AS id FROM raw.records WHERE entity = 'notes'",
    );
    expect(rows.map((r) => r.id)).toEqual(["n1"]);
  });
});
