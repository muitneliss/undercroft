// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: The 50 sites whose type the compiler could print are annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type is supplied contextually and writing it out means naming a library-internal type that will drift on the next upgrade.
// biome-ignore-all lint/security/noSecrets: False positives. The rule flags high-entropy string literals, and these are test fixtures with invented values (per .claude/rules/pii.md, fixtures are invented rather than anonymised), plus base64url sample tokens and SQL role names. No real credential is in any tracked file; CI enforces that separately.
// biome-ignore-all lint/suspicious/useAwait: An async function with no await, because the port it implements returns a promise. The contract is the signature, not the body -- `.claude/rules/tests.md` and the ESLint config this replaced both called this out by name.

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, createLogger, createStampSource, TestClock } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";
import { landRecords } from "../services/land.ts";
import { loadStreamToRaw } from "../services/loadToRaw.ts";
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

beforeEach(async () => {
  backing = new InMemoryObjectStore();
  lake = new LakeStore(backing, { stamps: createStampSource(new TestClock()) });
  db = await createTestDatabase();
  await migrate(db);
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

describe("landing records into the lake", () => {
  it("a first landing creates; re-landing the same records writes nothing", async () => {
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

  it("a malformed request is a 400 with the offending path", async () => {
    const res = await post({ source: "hubspot" }); // missing tenantId, runId, records
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string; details: string[] };
    expect(json.code).toBe("invalid_request");
    expect(json.details.length).toBeGreaterThan(0);
  });

  it("every batch is a run in the ledger, and batches under one id add up", async () => {
    function batch(id: string): unknown {
      return {
        source: "hubspot",
        tenantId: "CASE-1",
        runId: "ext-1",
        records: [
          {
            entity: "deals",
            sourceRecordId: id,
            sourceUpdatedAt: null,
            payloadText: `{"id":"${id}"}`,
          },
        ],
      };
    }
    expect((await post(batch("1"))).status).toBe(200);
    expect((await post(batch("2"))).status).toBe(200);

    const { rows } = await db.query<{ trigger: string; status: string; created: number }>(
      "SELECT trigger, status, created FROM ops.run WHERE id = 'ext-1'",
    );
    expect(rows[0]).toEqual({ trigger: "lake-api", status: "ok", created: 2 });
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

describe("the request line and the error boundary", () => {
  function lines(): { sink: string[]; log: ReturnType<typeof createLogger> } {
    const sink: string[] = [];
    return { sink, log: createLogger({ component: "worker", sink: (line) => sink.push(line) }) };
  }

  it("a healthy request answers with an x-request-id and writes exactly one request line", async () => {
    const { sink, log } = lines();
    const res = await createLakeApi({ lake, exec: db, serviceToken: "svc-token", log }).request(
      "/health",
    );
    expect(res.status).toBe(200);
    const requestId = res.headers.get("x-request-id");
    expect(requestId).not.toBeNull();

    const events = sink.map((line) => JSON.parse(line) as { event: string; requestId?: string });
    expect(events.map((e) => e.event)).toEqual(["request"]);
    expect(events[0]?.requestId).toBe(requestId ?? "");
  });

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
    // The run opened and failed before the boundary saw the error; the boundary's two lines
    // close the request. The failure line carries the type, never the path in the message.
    expect(events.map((e) => e.event)).toEqual([
      "run_opened",
      "run_failed",
      "request_failed",
      "request",
    ]);
    expect(events[2]?.errorType).toBe("Error");
    expect(events[3]?.status).toBe(500);
  });
});

describe("loading the lake into raw.records", () => {
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
