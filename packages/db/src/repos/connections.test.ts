// biome-ignore-all lint/style/noNonNullAssertion: Almost all of these are tests asserting on a fixture they created three lines earlier, which the ESLint config this replaced also exempted for the same reason. Biome's unsafe autofix for the rule deletes the `!` and leaves `string | undefined` flowing into a `string`, so it does not compile.

// biome-ignore-all lint/style/noMagicNumbers: In a test the number IS the assertion. `expect(delayMs).toBe(5000)` says what the code must do; `expect(delayMs).toBe(EXPECTED_BACKOFF_MS)` says only that two names agree, and it can pass while both are wrong. Naming a fixture value also puts the expected result somewhere other than the line asserting it, which is the opposite of what .claude/rules/tests.md asks for. Source files get named constants; test files keep their literals.

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

// biome-ignore-all lint/correctness/useQwikValidLexicalScope: Qwik-domain rule about what may cross a `$()` serialization boundary. There is no Qwik in this repo.
// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { migrate } from "../migrate.ts";
import { createTestDatabase, type TestDatabase } from "../testing.ts";
import {
  ConnectionRegistryError,
  type Credential,
  readCredential,
  upsertConnection,
  writeCredential,
} from "./connections.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");
const env: NodeJS.ProcessEnv = { UNDERCROFT_SECRET_KEY: KEY };

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
  await upsertConnection(db, { tenantId: "CASE-1", source: "xero", status: "connected" });
});

afterEach(async () => {
  await db.close();
});

function cred(over: Partial<Credential> = {}): Credential {
  return {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: null,
    ...over,
  };
}

describe("credentials are sealed at rest and open exactly", () => {
  it("what is written comes back unchanged", async () => {
    await writeCredential(db, "CASE-1", "xero", cred(), env);
    const opened = await readCredential(db, "CASE-1", "xero", { env });
    expect(opened.accessToken).toBe("access-1");
    expect(opened.refreshToken).toBe("refresh-1");
  });

  it("the stored bytes are not the plaintext", async () => {
    await writeCredential(db, "CASE-1", "xero", cred(), env);
    const { rows } = await db.query<{ ciphertext: Uint8Array }>(
      "SELECT ciphertext FROM app.connection_secret WHERE tenant_id = 'CASE-1'",
    );
    expect(Buffer.from(rows[0]!.ciphertext).toString("utf8")).not.toContain("access-1");
  });

  it("reading a credential that was never stored is a clear error, not a guess", async () => {
    await expect(readCredential(db, "CASE-1", "xero", { env })).rejects.toBeInstanceOf(
      ConnectionRegistryError,
    );
  });
});
