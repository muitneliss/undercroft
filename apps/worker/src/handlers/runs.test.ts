/**
 * The run verbs over HTTP: a run is accepted with its id and finishes without the caller,
 * and everything that refuses does so before a row exists.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryFetcher } from "@undercroft/connector-runtime/testing";
import { createStampSource, InMemoryByteFetcher, TestClock } from "@undercroft/core";
import { seal } from "@undercroft/crypto";
import { openRun } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { drainJobs } from "../services/jobs.ts";
import { noDatabase } from "../testing.ts";
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

beforeEach(() => {
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
});

/**
 * A migrated database with one connected and one expired connection, and their specs on disk,
 * entered as the worker. Per describe, so the token refusals at the end of the file do not
 * open a database they never reach.
 */
function withDatabase(): void {
  beforeEach(async () => {
    db = await createMigratedTestDatabase();
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
}

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
  withDatabase();

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

  it("a second Gmail mailbox runs on its own credential and lands under its own source", async () => {
    // ADR 0043: a further account is a source of its own. Every step of the run reads the
    // source's KIND -- the Google path, the scope check, the refresher -- and a step that read
    // the literal source instead would look for `gmail.3fa9c1d2e0ab.yaml` and fail.
    const SECOND = "gmail.3fa9c1d2e0ab";
    const sealed = seal(
      JSON.stringify({
        accessToken: "tok-b",
        refreshToken: "",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
      { env: { UNDERCROFT_SECRET_KEY: KEY } },
    );
    await db.asSuperuser(async (tx) => {
      await tx.query(
        "INSERT INTO ops.connection (tenant_id, source, status, external_account_id) VALUES ('CASE-1', $1, 'connected', '208134092834092834')",
        [SECOND],
      );
      await tx.query(
        "INSERT INTO app.connection_secret (tenant_id, source, ciphertext, key_version) VALUES ('CASE-1', $1, $2, 1)",
        [SECOND, Buffer.from(sealed.blob)],
      );
      await tx.query(
        `INSERT INTO app.connection_detail (tenant_id, source, selection) VALUES ('CASE-1', $1, '{"labels":[]}'::jsonb)`,
        [SECOND],
      );
    });
    const gmail = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
    const google = new InMemoryByteFetcher()
      .on("GET", `${gmail}?maxResults=100`, { body: { messages: [{ id: "m1" }] } })
      .on("GET", `${gmail}/m1?format=full`, {
        body: {
          id: "m1",
          threadId: "t1",
          labelIds: [],
          internalDate: "1700000000000",
          payload: {},
        },
      });
    const app = createLakeApi({
      lake,
      exec: db,
      serviceToken: "svc-token",
      specsDir,
      env: { UNDERCROFT_SECRET_KEY: KEY },
      byteFetcher: google,
    });

    const res = await post(app, "/v1/runs/ingest", { source: SECOND, tenantId: "CASE-1" });
    const { runId } = (await res.json()) as { runId: string };
    await drainJobs();

    expect(await statusOf(runId)).toBe("ok");
    expect(google.calls[0]?.headers?.authorization).toBe("Bearer tok-b");
    const { rows } = await db.query<{ source: string; source_record_id: string }>(
      "SELECT source, source_record_id FROM raw.records WHERE tenant_id = 'CASE-1'",
    );
    expect(rows).toEqual([{ source: SECOND, source_record_id: "m1" }]);
  });

  it("a source no connection could have is 404 before any run exists", async () => {
    // A suffix on a kind that cannot hold a second account, or a path, is not a source.
    const res = await post(api(), "/v1/runs/ingest", {
      source: "demo.3fa9c1d2e0ab",
      tenantId: "CASE-1",
    });
    expect(res.status).toBe(404);
    const { rows } = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM ops.run");
    expect(rows[0]?.n).toBe("0");
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
  withDatabase();

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
});

describe("GET /v1/runs/due for a custom cadence", () => {
  withDatabase();

  async function seed(sql: string, params: unknown[] = []): Promise<void> {
    await db.asSuperuser((tx) => tx.query(sql, params));
  }

  async function due(): Promise<unknown> {
    const res = await api().request("/v1/runs/due", {
      headers: { authorization: "Bearer svc-token" },
    });
    return res.json();
  }

  it("starts the pair once a fire has passed since its last run, and not before", async () => {
    // Noon every day, Singapore time. The same expression on both sides, so what differs is
    // only whether a fire has come round since the last run started.
    await seed(
      "UPDATE ops.connection SET cadence = 'custom', cron = '0 12 * * *' WHERE source = 'demo'",
    );
    await seed(
      `INSERT INTO ops.run (id, tenant_id, source, verb, status, started_at, ended_at)
       VALUES ('r-old', 'CASE-1', 'demo', 'ingest', 'ok', now() - interval '2 days', now() - interval '2 days')`,
    );
    expect(await due()).toEqual({ due: [{ tenantId: "CASE-1", source: "demo" }] });

    // A run that started just now satisfies every fire before it; the next is in the future.
    await seed(
      `INSERT INTO ops.run (id, tenant_id, source, verb, status, started_at, ended_at)
       VALUES ('r-new', 'CASE-1', 'demo', 'ingest', 'ok', now(), now())`,
    );
    expect(await due()).toEqual({ due: [] });
  });
});

describe("GET /v1/runs/extract-due", () => {
  withDatabase();

  const SHA_A = "a".repeat(64);

  /** Catalogue a document the way an ingest leaves one. `sha` is what its bytes hashed to. */
  async function landed(documentId: string, sha: string): Promise<void> {
    await db.query(
      `INSERT INTO raw.documents
         (source, tenant_id, document_id, lake_key, sha256, byte_length, content_type,
          observed_at, run_id)
       VALUES ('drive', 'CASE-1', $1, $2, $3, 10, 'application/pdf', now(), 'run-seed')`,
      [documentId, `documents/drive/CASE-1/${documentId}`, sha],
    );
  }

  /** Record that a document was read, from the bytes `sha` names. */
  async function readFrom(documentId: string, sha: string): Promise<void> {
    await db.query(
      `INSERT INTO raw.document_text
         (source, tenant_id, document_id, source_sha256, method, text, chars, extracted_at, run_id)
       VALUES ('drive', 'CASE-1', $1, $2, 'pdf_text', 'a page', 6, now(), 'run-seed')`,
      [documentId, sha],
    );
  }

  async function extractDue(): Promise<Response> {
    return await api().request("/v1/runs/extract-due", {
      headers: { authorization: "Bearer svc-token" },
    });
  }

  it("lists a pair holding a document nobody has read", async () => {
    await landed("doc-1", SHA_A);

    const res = await extractDue();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ due: [{ tenantId: "CASE-1", source: "drive" }] });
  });

  it("stops listing a pair once its documents are read, so the tick does not run forever", async () => {
    // The half of the guard that makes an hourly schedule cheap rather than wasteful: a
    // settled tenant must fall off the list, or every tick starts a run that finds nothing.
    await landed("doc-1", SHA_A);
    await readFrom("doc-1", SHA_A);

    expect(await (await extractDue()).json()).toEqual({ due: [] });
  });

  // Which documents count as pending -- changed bytes, a tombstone -- is the repo predicate's,
  // proven in `repos/documentText.test.ts`. These two are that the route answers with it.
});

describe("GET /v1/runs/:id", () => {
  withDatabase();

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

describe("a tick without the trigger token", () => {
  // `noDatabase` refuses every statement, so the 401 is also proven to come before any SQL.
  function app() {
    return createLakeApi({ lake, exec: noDatabase, serviceToken: "svc-token" });
  }

  it("is refused by the due list", async () => {
    expect((await app().request("/v1/runs/due")).status).toBe(401);
  });

  it("is refused by the extract-due list", async () => {
    expect((await app().request("/v1/runs/extract-due")).status).toBe(401);
  });
});
