/**
 * The run verbs over HTTP: a run is accepted with its id and finishes without the caller,
 * and everything that refuses does so before a row exists.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryFetcher } from "@undercroft/connector-runtime/testing";
import { createStampSource, TestClock } from "@undercroft/core";
import { seal } from "@undercroft/crypto";
import { migrate } from "@undercroft/db";
import { openRun } from "@undercroft/db/repos";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { drainJobs } from "../services/jobs.ts";
import { createLakeApi } from "./lake.ts";

const BASE = "https://demo.test";
const SPEC = `
apiVersion: undercroft.dev/v1
kind: Connector
id: demo
displayName: Demo
baseUrl: ${BASE}
auth: { kind: bearer, token: { from: connection } }
defaults:
  pagination: { kind: json-link, nextPath: paging.next.link }
entities:
  - name: things
    request: { kind: list, path: /things }
    envelopePath: results
    idPath: id
`;
const KEY = Buffer.alloc(32, 3).toString("base64");

let db: TestDatabase;
let lake: LakeStore;
let specsDir: string;

function sealDemoToken(): Buffer {
  const sealed = seal(JSON.stringify({ accessToken: "tok", refreshToken: "", expiresAt: null }), {
    env: { UNDERCROFT_SECRET_KEY: KEY },
  });
  return Buffer.from(sealed.blob);
}

beforeEach(async () => {
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
  await db.exec("CREATE TABLE raw.records_demo PARTITION OF raw.records FOR VALUES IN ('demo')");
  await db.query(
    "INSERT INTO ops.connection (tenant_id, source, status) VALUES ('CASE-1','demo','connected'), ('CASE-1','stale','expired')",
  );
  await db.query(
    "INSERT INTO app.connection_secret (tenant_id, source, ciphertext, key_version) VALUES ('CASE-1','demo',$1,1)",
    [sealDemoToken()],
  );
  specsDir = mkdtempSync(join(tmpdir(), "undercroft-specs-"));
  writeFileSync(join(specsDir, "demo.yaml"), SPEC);
  writeFileSync(join(specsDir, "stale.yaml"), SPEC.replace("id: demo", "id: stale"));
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await drainJobs();
  await db.close();
});

function api(fetcher = new InMemoryFetcher()) {
  return createLakeApi({
    lake,
    exec: db,
    serviceToken: "svc-token",
    specsDir,
    env: { UNDERCROFT_SECRET_KEY: KEY },
    fetcher,
  });
}

function post(app: ReturnType<typeof api>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer svc-token" },
    body: JSON.stringify(body),
  });
}

async function statusOf(runId: string): Promise<string | undefined> {
  const { rows } = await db.query<{ status: string }>("SELECT status FROM ops.run WHERE id = $1", [
    runId,
  ]);
  return rows[0]?.status;
}

describe("POST /v1/runs/ingest", () => {
  it("answers 202 with the run's id, and the run finishes without the caller", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "1" }, { id: "2" }], paging: {} },
    });
    const res = await post(api(fetcher), "/v1/runs/ingest", {
      source: "demo",
      tenantId: "CASE-1",
      trigger: "manual",
      triggeredBy: "u-1",
    });
    expect(res.status).toBe(202);
    const { runId } = (await res.json()) as { runId: string };
    expect(await statusOf(runId)).toBe("running");

    await drainJobs();
    expect(await statusOf(runId)).toBe("ok");
    const { rows } = await db.query<{ created: number; trigger: string; triggered_by: string }>(
      "SELECT created, trigger, triggered_by FROM ops.run WHERE id = $1",
      [runId],
    );
    expect(rows[0]).toEqual({ created: 2, trigger: "manual", triggered_by: "u-1" });
  });

  it("a run already in progress is 409, naming it in details, and opens nothing", async () => {
    await openRun(db, {
      id: "held",
      tenantId: "CASE-1",
      source: "demo",
      verb: "ingest",
      trigger: "schedule",
    });
    const res = await post(api(), "/v1/runs/ingest", { source: "demo", tenantId: "CASE-1" });
    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string; details: string[] };
    expect(json.code).toBe("run_in_progress");
    expect(json.details).toEqual(["held"]);
    const { rows } = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM ops.run");
    expect(rows[0]?.n).toBe("1");
  });

  it("a source whose grant is not usable is 409 before any run exists", async () => {
    const res = await post(api(), "/v1/runs/ingest", { source: "stale", tenantId: "CASE-1" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("credential_unusable");
    const { rows } = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM ops.run");
    expect(rows[0]?.n).toBe("0");
  });

  it("an unknown tenant is 404", async () => {
    const res = await post(api(), "/v1/runs/ingest", { source: "demo", tenantId: "CASE-9" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("not_found");
  });

  it("a failed run is recorded as failed and the verb still answered 202", async () => {
    // No request modelled: the source refuses the first read.
    const res = await post(api(new InMemoryFetcher()), "/v1/runs/ingest", {
      source: "demo",
      tenantId: "CASE-1",
    });
    expect(res.status).toBe(202);
    const { runId } = (await res.json()) as { runId: string };
    await drainJobs();
    expect(await statusOf(runId)).toBe("failed");
  });
});

describe("GET /v1/runs/due", () => {
  const GMAIL_SCOPE = JSON.stringify({ labels: [{ id: "Label_8", name: "Invoices" }] });

  async function seed(sql: string, params: unknown[] = []): Promise<void> {
    await db.asSuperuser((tx) => tx.query(sql, params));
  }

  it("lists the connected pairs whose gap has passed, and nothing that cannot run", async () => {
    // demo: connected, hourly, last ran two hours ago -> due.
    await seed("UPDATE ops.connection SET cadence = 'hourly' WHERE source = 'demo'");
    await seed(
      `INSERT INTO ops.run (id, tenant_id, source, verb, status, started_at, ended_at)
       VALUES ('r-old', 'CASE-1', 'demo', 'ingest', 'ok', now() - interval '2 hours', now() - interval '2 hours')`,
    );
    // gmail: connected, scoped and chosen, never ran -> due now.
    await seed(
      "INSERT INTO ops.connection (tenant_id, source, status) VALUES ('CASE-1', 'gmail', 'connected')",
    );
    await seed(
      "INSERT INTO app.connection_detail (tenant_id, source, selection) VALUES ('CASE-1', 'gmail', $1::jsonb)",
      [GMAIL_SCOPE],
    );
    // drive: connected but nobody has chosen what to read -> not due.
    await seed(
      "INSERT INTO ops.connection (tenant_id, source, status) VALUES ('CASE-1', 'drive', 'connected')",
    );
    // hubspot: connected but paused -> not due. stale (seeded above): expired -> not due.
    await seed(
      "INSERT INTO ops.connection (tenant_id, source, status, cadence) VALUES ('CASE-1', 'hubspot', 'connected', 'paused')",
    );

    const res = await api().request("/v1/runs/due", {
      headers: { authorization: "Bearer svc-token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      due: [
        { tenantId: "CASE-1", source: "demo" },
        { tenantId: "CASE-1", source: "gmail" },
      ],
    });
  });

  it("a pair inside its gap, or with a run in progress, is not asked for again", async () => {
    await seed("UPDATE ops.connection SET cadence = 'hourly' WHERE source = 'demo'");
    await openRun(db, {
      id: "r-live",
      tenantId: "CASE-1",
      source: "demo",
      verb: "ingest",
      trigger: "schedule",
    });
    const live = await api().request("/v1/runs/due", {
      headers: { authorization: "Bearer svc-token" },
    });
    expect(await live.json()).toEqual({ due: [] });

    await seed("UPDATE ops.run SET status = 'ok', ended_at = now() WHERE id = 'r-live'");
    const fresh = await api().request("/v1/runs/due", {
      headers: { authorization: "Bearer svc-token" },
    });
    expect(await fresh.json()).toEqual({ due: [] });
  });

  it("needs the trigger token", async () => {
    expect((await api().request("/v1/runs/due")).status).toBe(401);
  });
});

describe("GET /v1/runs/:id", () => {
  it("returns the run for whoever holds the trigger token, and 404 for no such run", async () => {
    await openRun(db, {
      id: "r1",
      tenantId: "CASE-1",
      source: "demo",
      verb: "ingest",
      trigger: "schedule",
    });
    const app = api();
    const found = await app.request("/v1/runs/r1", {
      headers: { authorization: "Bearer svc-token" },
    });
    expect(found.status).toBe(200);
    expect(((await found.json()) as { status: string }).status).toBe("running");

    const missing = await app.request("/v1/runs/nope", {
      headers: { authorization: "Bearer svc-token" },
    });
    expect(missing.status).toBe(404);

    const anonymous = await app.request("/v1/runs/r1");
    expect(anonymous.status).toBe(401);
  });
});
