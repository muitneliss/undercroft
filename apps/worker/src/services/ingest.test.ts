// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryFetcher } from "@undercroft/connector-runtime/testing";
import { createStampSource, TestClock } from "@undercroft/core";
import { seal } from "@undercroft/crypto";
import { migrate } from "@undercroft/db";
import { eventsFor, openRun } from "@undercroft/db/repos";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { RunInProgress, runIngest } from "./ingest.ts";

const BASE = "https://demo.test";

// A minimal single-entity list connector, written to a temp dir so runIngest loads it the
// same way it loads a shipped spec. (The shipped HubSpot spec includes a batch-from
// entity, which the runtime does not yet drive; this test stays on the list path.)
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

let backing: InMemoryObjectStore;
let lake: LakeStore;
let db: TestDatabase;
let specsDir: string;

beforeEach(async () => {
  backing = new InMemoryObjectStore();
  lake = new LakeStore(backing, { stamps: createStampSource(new TestClock()) });
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
  await db.exec("CREATE TABLE raw.records_demo PARTITION OF raw.records FOR VALUES IN ('demo')");
  await db.query(
    "INSERT INTO ops.connection (tenant_id, source, status) VALUES ('CASE-1','demo','connected')",
  );
  await db.query(
    "INSERT INTO app.connection_secret (tenant_id, source, ciphertext, key_version) VALUES ('CASE-1','demo',$1,1)",
    [sealDemoToken()],
  );
  specsDir = mkdtempSync(join(tmpdir(), "undercroft-specs-"));
  writeFileSync(join(specsDir, "demo.yaml"), SPEC);
  // Seeded as the superuser; from here on every statement runs as the worker does.
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

// A credential sealed with a fixed key, so accessToken can open it inside runIngest.
const KEY = Buffer.alloc(32, 3).toString("base64");
function sealDemoToken(): Buffer {
  const sealed = seal(JSON.stringify({ accessToken: "tok", refreshToken: "", expiresAt: null }), {
    env: { UNDERCROFT_SECRET_KEY: KEY },
  });
  return Buffer.from(sealed.blob);
}

describe("the ingest run verb ties the slice together", () => {
  it("spec -> runtime -> lake -> raw.records, in one call", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: {
        results: [
          { id: "1", v: "a" },
          { id: "2", v: "b" },
        ],
        paging: {},
      },
    });

    const result = await runIngest(
      { lake, exec: db, specsDir, fetcher, env: { UNDERCROFT_SECRET_KEY: KEY } },
      { source: "demo", tenantId: "CASE-1" },
    );

    expect(result.entities[0]?.entity).toBe("things");
    expect(result.entities[0]?.landed).toBe(2);
    expect(result.entities[0]?.loadedCreated).toBe(2);

    const { rows } = await db.query<{ id: string }>(
      "SELECT source_record_id AS id FROM raw.records WHERE source = 'demo' ORDER BY source_record_id",
    );
    expect(rows.map((r) => r.id)).toEqual(["1", "2"]);
  });
});

describe("every run is a row in the ledger", () => {
  function goodFetcher(): InMemoryFetcher {
    return new InMemoryFetcher().on("GET", `${BASE}/things`, {
      body: { results: [{ id: "1" }, { id: "2" }], paging: {} },
    });
  }

  it("a run that worked is recorded as ok, with what each entity landed", async () => {
    const result = await runIngest(
      { lake, exec: db, specsDir, fetcher: goodFetcher(), env: { UNDERCROFT_SECRET_KEY: KEY } },
      { source: "demo", tenantId: "CASE-1", trigger: "manual", triggeredBy: "u-1" },
    );

    const { rows } = await db.query<{
      status: string;
      trigger: string;
      triggered_by: string;
      created: number;
      ended_at: string | null;
    }>("SELECT status, trigger, triggered_by, created, ended_at FROM ops.run WHERE id = $1", [
      result.runId,
    ]);
    expect(rows[0]?.status).toBe("ok");
    expect(rows[0]?.trigger).toBe("manual");
    expect(rows[0]?.triggered_by).toBe("u-1");
    expect(rows[0]?.created).toBe(2);
    expect(rows[0]?.ended_at).not.toBeNull();

    const entities = await db.query<{ entity: string; landed: number; created: number }>(
      "SELECT entity, landed, created FROM ops.run_entity WHERE run_id = $1",
      [result.runId],
    );
    expect(entities.rows).toEqual([{ entity: "things", landed: 2, created: 2 }]);
  });

  it("a run that failed is recorded as failed with the fault, and does not block the next", async () => {
    // A fetcher modelling no request refuses the first one, which is a source fault.
    let failed = "";
    try {
      await runIngest(
        {
          lake,
          exec: db,
          specsDir,
          fetcher: new InMemoryFetcher(),
          env: { UNDERCROFT_SECRET_KEY: KEY },
        },
        { source: "demo", tenantId: "CASE-1" },
      );
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
    }
    expect(failed).not.toBe("");

    const { rows } = await db.query<{ status: string; error: string | null }>(
      "SELECT status, error FROM ops.run WHERE tenant_id = 'CASE-1' AND source = 'demo'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.error).not.toBeNull();

    const next = await runIngest(
      { lake, exec: db, specsDir, fetcher: goodFetcher(), env: { UNDERCROFT_SECRET_KEY: KEY } },
      { source: "demo", tenantId: "CASE-1" },
    );
    expect(next.entities[0]?.landed).toBe(2);
  });

  it("and narrates itself as it goes, so a run in progress is not a blank screen", async () => {
    const result = await runIngest(
      { lake, exec: db, specsDir, fetcher: goodFetcher(), env: { UNDERCROFT_SECRET_KEY: KEY } },
      { source: "demo", tenantId: "CASE-1", trigger: "manual" },
    );

    const events = await eventsFor(db, result.runId);
    expect(events.map((e) => e.event)).toEqual([
      "run_opened",
      "entity_started",
      "records_read",
      "entity_done",
      "run_closed",
    ]);
    // The feed's counts are the ledger's counts: two ways of saying one thing would be two
    // things to keep in step.
    expect(events.find((e) => e.event === "entity_done")?.detail).toEqual({
      landed: 2,
      created: 2,
      changed: 0,
      unchanged: 0,
      refused: 0,
    });
  });

  it("a run that failed says so in its feed, with the fault's type and no payload", async () => {
    let runId = "";
    try {
      await runIngest(
        {
          lake,
          exec: db,
          specsDir,
          fetcher: new InMemoryFetcher(),
          env: { UNDERCROFT_SECRET_KEY: KEY },
        },
        { source: "demo", tenantId: "CASE-1" },
      );
    } catch {
      const { rows } = await db.query<{ id: string }>(
        "SELECT id FROM ops.run WHERE tenant_id = 'CASE-1' AND source = 'demo'",
      );
      runId = rows[0]?.id ?? "";
    }

    const last = (await eventsFor(db, runId)).at(-1);
    expect(last?.event).toBe("run_failed");
    expect(last?.level).toBe("error");
    expect(last?.detail.errorType).toBe("ConnectorError");
    expect(last?.detail).not.toHaveProperty("errorMessage");
  });

  it("a run while one is in progress is refused, naming the run that is running", async () => {
    await openRun(db, {
      id: "held",
      tenantId: "CASE-1",
      source: "demo",
      verb: "ingest",
      trigger: "schedule",
    });
    let refused: unknown = null;
    try {
      await runIngest(
        { lake, exec: db, specsDir, fetcher: goodFetcher(), env: { UNDERCROFT_SECRET_KEY: KEY } },
        { source: "demo", tenantId: "CASE-1" },
      );
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(RunInProgress);
    expect((refused as RunInProgress).runId).toBe("held");
    // Nothing was landed on the strength of a refused run.
    expect((await backing.list("_blobs/")).length).toBe(0);
  });
});
