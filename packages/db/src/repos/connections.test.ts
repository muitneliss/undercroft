import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { createMigratedTestDatabase, type TestDatabase } from "../testing.ts";
import {
  ConnectionRegistryError,
  type Credential,
  getConnection,
  readCredential,
  setCadence,
  upsertConnection,
  writeCredential,
} from "./connections.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");
const env: NodeJS.ProcessEnv = { UNDERCROFT_SECRET_KEY: KEY };

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
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
  beforeEach(async () => {
    // Only the worker holds UNDERCROFT_SECRET_KEY, so only it seals and opens credentials
    // (apps/worker/src/services/connections.ts).
    await db.become("undercroft_worker");
  });

  it("what is written comes back unchanged", async () => {
    await writeCredential(db, "CASE-1", "xero", cred(), { env });
    const opened = await readCredential(db, "CASE-1", "xero", { env });
    expect(opened.accessToken).toBe("access-1");
    expect(opened.refreshToken).toBe("refresh-1");
  });

  it("the stored bytes are not the plaintext", async () => {
    await writeCredential(db, "CASE-1", "xero", cred(), { env });
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

describe("cadence", () => {
  beforeEach(async () => {
    // An admin sets cadence through the control plane (services/connections.ts).
    await db.become("undercroft_app");
  });

  it("a connection reads daily until an admin says otherwise, and the word is stored", async () => {
    expect((await getConnection(db, "CASE-1", "xero"))?.cadence).toBe("daily");
    expect(await setCadence(db, "CASE-1", "xero", { cadence: "hourly", cron: null })).toBe(true);
    expect((await getConnection(db, "CASE-1", "xero"))?.cadence).toBe("hourly");
  });

  it("a custom cadence keeps its expression, and a preset chosen after it clears it", async () => {
    await setCadence(db, "CASE-1", "xero", { cadence: "custom", cron: "30 7 * * 1-5" });
    expect(await getConnection(db, "CASE-1", "xero")).toMatchObject({
      cadence: "custom",
      cron: "30 7 * * 1-5",
    });

    await setCadence(db, "CASE-1", "xero", { cadence: "daily", cron: null });
    expect(await getConnection(db, "CASE-1", "xero")).toMatchObject({
      cadence: "daily",
      cron: null,
    });
  });

  it("the table refuses a custom cadence with no expression, and a preset with one", async () => {
    // The invariant holds whoever writes: the service refuses first, the CHECK regardless.
    await expect(
      setCadence(db, "CASE-1", "xero", { cadence: "custom", cron: null }),
    ).rejects.toThrow("connection_cron_iff_custom");
    await expect(
      setCadence(db, "CASE-1", "xero", { cadence: "daily", cron: "0 9 * * *" }),
    ).rejects.toThrow("connection_cron_iff_custom");
    expect((await getConnection(db, "CASE-1", "xero"))?.cadence).toBe("daily");
  });

  it("a source nobody has connected has nothing to set a cadence on", async () => {
    expect(await setCadence(db, "CASE-1", "hubspot", { cadence: "hourly", cron: null })).toBe(
      false,
    );
  });
});
