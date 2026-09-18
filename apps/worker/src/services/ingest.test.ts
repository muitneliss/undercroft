// biome-ignore-all lint/style/noMagicNumbers: In a test the number IS the assertion. `expect(delayMs).toBe(5000)` says what the code must do; `expect(delayMs).toBe(EXPECTED_BACKOFF_MS)` says only that two names agree, and it can pass while both are wrong. Naming a fixture value also puts the expected result somewhere other than the line asserting it, which is the opposite of what .claude/rules/tests.md asks for. Source files get named constants; test files keep their literals.

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

// biome-ignore-all lint/correctness/noNodejsModules: This is server code running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.
// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryFetcher } from "@undercroft/connector-runtime/testing";
import { createStampSource, TestClock } from "@undercroft/core";
import { seal } from "@undercroft/crypto";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

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
