import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, createLogger, createStampSource, TestClock } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";
import { landRecords } from "../services/land.ts";
import { loadStreamToRaw } from "../services/loadToRaw.ts";
import { noDatabase } from "../testing.ts";
import { createLakeApi } from "./lake.ts";

let backing: InMemoryObjectStore;
let lake: LakeStore;
let db: TestDatabase;

function record(
  id: string,
  payload: object,
): { entity: string; sourceRecordId: string; sourceUpdatedAt: null; payloadText: string } {
  return {
    entity: "deals",
    sourceRecordId: id,
    sourceUpdatedAt: null,
    payloadText: canonicalJson(payload),
  };
}

// For payloads with non-integer numbers: canonicalJson refuses a JS float (correctly), so
// the record's text is built from raw JSON where the number never becomes a JS number.
function recordText(
  id: string,
  payloadText: string,
): { entity: string; sourceRecordId: string; sourceUpdatedAt: null; payloadText: string } {
  return { entity: "deals", sourceRecordId: id, sourceUpdatedAt: null, payloadText };
}

beforeEach(() => {
  backing = new InMemoryObjectStore();
  lake = new LakeStore(backing, { stamps: createStampSource(new TestClock()) });
});

/**
 * A migrated database, seeded and then entered as the worker, for the describe that calls it.
 *
 * Per describe rather than at the top of the file, so the requests answered before any
 * statement runs (the last describe) do not pay for a database they never open.
 */
function withDatabase(): void {
  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
    await db.exec(
      "CREATE TABLE raw.records_hubspot PARTITION OF raw.records FOR VALUES IN ('hubspot')",
    );
    // Seeded as the superuser; from here on every statement runs as the worker does.
    await db.become("undercroft_worker");
  });

  afterEach(async () => {
    await db.close();
  });
}

describe("the lake records API", () => {
  withDatabase();

  function api() {
    return createLakeApi({ lake, exec: db, serviceToken: "svc-token" });
  }

  async function post(body: unknown, token = "svc-token"): Promise<Response> {
    return api().request("/v1/lake/records", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  it("lands a valid batch and reports created", async () => {
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

  it("an unauthenticated caller is refused before anything is written", async () => {
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

  it("every batch is a run in the ledger, triggered by the lake API", async () => {
    // How batches under one id add up is the repo's, and proven there
    // (`packages/db/src/repos/runs.test.ts`); this is that the route records the batch at all.
    const res = await post({
      source: "hubspot",
      tenantId: "CASE-1",
      runId: "ext-1",
      records: [
        { entity: "deals", sourceRecordId: "1", sourceUpdatedAt: null, payloadText: '{"id":"1"}' },
      ],
    });
    expect(res.status).toBe(200);

    const { rows } = await db.query<{ trigger: string; status: string; created: number }>(
      "SELECT trigger, status, created FROM ops.run WHERE id = 'ext-1'",
    );
    expect(rows[0]).toEqual({ trigger: "lake-api", status: "ok", created: 1 });
  });

  it("a run id that already belongs to another tenant is refused before anything lands", async () => {
    await db.asSuperuser((tx) => tx.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-2')"));
    expect(
      (
        await post({
          source: "hubspot",
          tenantId: "CASE-1",
          runId: "shared",
          records: [
            { entity: "deals", sourceRecordId: "1", sourceUpdatedAt: null, payloadText: "{}" },
          ],
        })
      ).status,
    ).toBe(200);
    const blobs = (await backing.list("_blobs/")).length;

    const res = await post({
      source: "hubspot",
      tenantId: "CASE-2",
      runId: "shared",
      records: [{ entity: "deals", sourceRecordId: "9", sourceUpdatedAt: null, payloadText: "{}" }],
    });
    expect(res.status).toBe(400);
    expect((await backing.list("_blobs/")).length).toBe(blobs);
  });
});

/** A logger whose lines are kept, so a test can read what the boundary wrote. */
function lines(): { sink: string[]; log: ReturnType<typeof createLogger> } {
  const sink: string[] = [];
  return { sink, log: createLogger({ component: "worker", sink: (line) => sink.push(line) }) };
}

describe("the request line and the error boundary", () => {
  withDatabase();

  it("an unexpected failure is a 500 whose body repeats none of the error, and the log has the type", async () => {
    const { sink, log } = lines();
    // A specs directory holding no spec: the ingest verb reads `demo.yaml` and gets ENOENT,
    // which is the kind of error nobody mapped -- and whose message names a filesystem path.
    const specsDir = mkdtempSync(join(tmpdir(), "undercroft-empty-specs-"));
    const res = await createLakeApi({
      lake,
      exec: db,
      serviceToken: "svc-token",
      log,
      specsDir,
    }).request("/v1/runs/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer svc-token" },
      body: JSON.stringify({ source: "demo", tenantId: "CASE-1" }),
    });
    expect(res.status).toBe(500);
    const json = (await res.json()) as { code: string; message: string };
    expect(json.code).toBe("internal_error");
    expect(json.message).not.toContain(specsDir);

    const events = sink.map(
      (line) => JSON.parse(line) as { event: string; errorType?: string; status?: number },
    );
    // The spec is read before a run is opened, so a missing one leaves no run behind: the
    // boundary's two lines are the whole record. The failure line carries the type, never
    // the path in the message.
    expect(events.map((e) => e.event)).toEqual(["request_failed", "request"]);
    expect(events[0]?.errorType).toBe("Error");
    expect(events[1]?.status).toBe(500);
    const { rows } = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM ops.run");
    expect(rows[0]?.n).toBe("0");
  });
});

describe("loading the lake into raw.records", () => {
  withDatabase();

  const identity = { source: "hubspot", tenantId: "CASE-1", entity: "deals" };

  it("first load inserts; a second load over an unchanged lake updates nothing", async () => {
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

  it("a changed payload is loaded as a change, keeping the newest", async () => {
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

  it("payload numbers are stored exactly, not through a float", async () => {
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

describe("what is answered before the database is asked", () => {
  // `noDatabase` refuses every statement, so each of these also proves that nothing was.
  function api(log?: ReturnType<typeof createLogger>) {
    return createLakeApi({
      lake,
      exec: noDatabase,
      serviceToken: "svc-token",
      ...(log === undefined ? {} : { log }),
    });
  }

  it("a malformed batch is a 400 naming every path it is missing", async () => {
    const res = await api().request("/v1/lake/records", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer svc-token" },
      body: JSON.stringify({ source: "hubspot" }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string; details: string[] };
    expect(json.code).toBe("invalid_request");
    const paths = json.details.map((detail) => detail.slice(0, detail.indexOf(":")));
    expect(paths.sort((a, b) => a.localeCompare(b))).toEqual(["records", "runId", "tenantId"]);
  });

  it("a request continues the caller's trace, answers with its id under both headers, and writes exactly one request line", async () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const { sink, log } = lines();
    const res = await api(log).request("/health", {
      headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-trace-id")).toBe(traceId);
    expect(res.headers.get("x-request-id")).toBe(traceId);

    const events = sink.map((line) => JSON.parse(line) as { event: string; requestId?: string });
    expect(events.map((e) => e.event)).toEqual(["request"]);
    expect(events[0]?.requestId).toBe(traceId);
  });
});
