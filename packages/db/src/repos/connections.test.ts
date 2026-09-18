import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ConnectionRegistryError,
  type Credential,
  readCredential,
  upsertConnection,
  writeCredential,
} from "./connections.ts";
import { migrate } from "../migrate.ts";
import { createTestDatabase, type TestDatabase } from "../testing.ts";

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

const cred = (over: Partial<Credential> = {}): Credential => ({
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: null,
  ...over,
});

describe("credentials are sealed at rest and open exactly", () => {
  test("what is written comes back unchanged", async () => {
    await writeCredential(db, "CASE-1", "xero", cred(), env);
    const opened = await readCredential(db, "CASE-1", "xero", { env });
    expect(opened.accessToken).toBe("access-1");
    expect(opened.refreshToken).toBe("refresh-1");
  });

  test("the stored bytes are not the plaintext", async () => {
    await writeCredential(db, "CASE-1", "xero", cred(), env);
    const { rows } = await db.query<{ ciphertext: Uint8Array }>(
      "SELECT ciphertext FROM app.connection_secret WHERE tenant_id = 'CASE-1'",
    );
    expect(Buffer.from(rows[0]!.ciphertext).toString("utf8")).not.toContain("access-1");
  });

  test("reading a credential that was never stored is a clear error, not a guess", async () => {
    await expect(readCredential(db, "CASE-1", "xero", { env })).rejects.toBeInstanceOf(
      ConnectionRegistryError,
    );
  });
});
