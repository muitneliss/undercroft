import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { canonicalJson, createStampSource, TestClock } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";
import { landRecords } from "../services/land.ts";
import { loadStreamToRaw } from "../services/loadToRaw.ts";
import { createLakeApi } from "./lake.ts";

let backing: InMemoryObjectStore;
let lake: LakeStore;
let db: TestDatabase;

function record(id: string, payload: object) {
  return {
    entity: "deals",
    sourceRecordId: id,
    sourceUpdatedAt: null,
    payloadText: canonicalJson(payload),
  };
}

// For payloads with non-integer numbers: canonicalJson refuses a JS float (correctly), so
// the record's text is built from raw JSON where the number never becomes a JS number.
function recordText(id: string, payloadText: string) {
  return { entity: "deals", sourceRecordId: id, sourceUpdatedAt: null, payloadText };
}

beforeEach(async () => {
  backing = new InMemoryObjectStore();
  lake = new LakeStore(backing, { stamps: createStampSource(new TestClock()) });
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
  await db.exec(
    "CREATE TABLE raw.records_hubspot PARTITION OF raw.records FOR VALUES IN ('hubspot')",
  );
});

afterEach(async () => {
  await db.close();
});

describe("landing records into the lake", () => {
  test("a first landing creates; re-landing the same records writes nothing", async () => {
    const records = [record("1", { id: "1", n: 10n }), record("2", { id: "2", n: 20n })];
    const first = await landRecords(lake, {
      source: "hubspot",
      tenantId: "CASE-1",
      runId: "r1",
      records,
    });
    expect(first.created).toBe(2);
    const blobsAfterFirst = (await backing.list("_blobs/")).length;

    const second = await landRecords(lake, {
      source: "hubspot",
      tenantId: "CASE-1",
      runId: "r2",
      records,
    });
    expect(second.created).toBe(0);
    expect(second.unchanged).toBe(2);
    // No new blobs: re-landing unchanged data is free.
    expect((await backing.list("_blobs/")).length).toBe(blobsAfterFirst);
  });
});

describe("the lake records API", () => {
  const api = () => createLakeApi({ lake, exec: db, serviceToken: "svc-token" });

  async function post(body: unknown, token = "svc-token") {
    return api().request("/v1/lake/records", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  test("lands a valid batch and reports created", async () => {
    const res = await post({
      source: "hubspot",
      tenantId: "CASE-1",
      runId: "r1",
      records: [
        { entity: "deals", sourceRecordId: "1", sourceUpdatedAt: null, payloadText: '{"id":"1"}' },
      ],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { created: number };
    expect(json.created).toBe(1);
  });

  test("an unauthenticated caller is refused before anything is written", async () => {
    const res = await post(
      {
        source: "hubspot",
        tenantId: "CASE-1",
        runId: "r1",
        records: [
          { entity: "deals", sourceRecordId: "1", sourceUpdatedAt: null, payloadText: "{}" },
        ],
      },
      "wrong-token",
    );
    expect(res.status).toBe(401);
    expect((await backing.list("_blobs/")).length).toBe(0);
  });

  test("a malformed request is a 400 with the offending path", async () => {
    const res = await post({ source: "hubspot" }); // missing tenantId, runId, records
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string; details: string[] };
    expect(json.code).toBe("invalid_request");
    expect(json.details.length).toBeGreaterThan(0);
  });
});

describe("loading the lake into raw.records", () => {
  const identity = { source: "hubspot", tenantId: "CASE-1", entity: "deals" };

  test("first load inserts; a second load over an unchanged lake updates nothing", async () => {
    await landRecords(lake, {
      source: "hubspot",
      tenantId: "CASE-1",
      runId: "r1",
      records: [record("1", { id: "1" }), record("2", { id: "2" })],
    });

    const first = await loadStreamToRaw(db, lake, identity);
    expect(first.created).toBe(2);

    const second = await loadStreamToRaw(db, lake, identity);
    // The idempotence guarantee: no new observations in the journal since the cursor.
    expect(second.created).toBe(0);
    expect(second.changed).toBe(0);
  });

  test("a changed payload is loaded as a change, keeping the newest", async () => {
    await landRecords(lake, {
      source: "hubspot",
      tenantId: "CASE-1",
      runId: "r1",
      records: [record("1", { id: "1", stage: "new" })],
    });
    await loadStreamToRaw(db, lake, identity);

    await landRecords(lake, {
      source: "hubspot",
      tenantId: "CASE-1",
      runId: "r2",
      records: [record("1", { id: "1", stage: "won" })],
    });
    const result = await loadStreamToRaw(db, lake, identity);
    expect(result.changed).toBe(1);

    const { rows } = await db.query<{ stage: string }>(
      "SELECT payload->>'stage' AS stage FROM raw.records WHERE source_record_id = '1'",
    );
    expect(rows[0]?.stage).toBe("won");
  });

  test("payload numbers are stored exactly, not through a float", async () => {
    await landRecords(lake, {
      source: "hubspot",
      tenantId: "CASE-1",
      runId: "r1",
      records: [recordText("1", '{"amount":8500.0001,"big":1234567890123456789012345,"id":"1"}')],
    });
    await loadStreamToRaw(db, lake, identity);
    const { rows } = await db.query<{ amount: string; big: string }>(
      "SELECT payload->>'amount' AS amount, payload->>'big' AS big FROM raw.records WHERE source_record_id = '1'",
    );
    expect(rows[0]?.amount).toBe("8500.0001");
    expect(rows[0]?.big).toBe("1234567890123456789012345");
  });
});
