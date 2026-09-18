import { createStampSource, TestClock } from "@undercroft/core";
import { InMemoryFetcher } from "@undercroft/connector-runtime/testing";
import { seal } from "@undercroft/crypto";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runIngest } from "./ingest.ts";

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
  test("spec -> runtime -> lake -> raw.records, in one call", async () => {
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
