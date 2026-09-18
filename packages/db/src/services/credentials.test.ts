import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { accessToken, needsRefresh } from "./credentials.ts";
import {
  ConnectionRegistryError,
  type Credential,
  readCredential,
  upsertConnection,
  writeCredential,
} from "../repos/connections.ts";
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

describe("needsRefresh treats missing expiry as fresh", () => {
  test("a credential with no expiry never refreshes (the HubSpot private-app case)", () => {
    expect(needsRefresh(cred({ expiresAt: null }))).toBe(false);
  });

  test("a credential inside the skew window needs a refresh", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const soon = new Date(now.getTime() + 60_000).toISOString(); // 1 min out, skew is 5
    expect(needsRefresh(cred({ expiresAt: soon }), now)).toBe(true);
  });

  test("a credential well outside the window does not", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const later = new Date(now.getTime() + 60 * 60_000).toISOString();
    expect(needsRefresh(cred({ expiresAt: later }), now)).toBe(false);
  });
});

describe("accessToken refreshes and writes the rotated token back", () => {
  test("returns the stored token when it is still fresh", async () => {
    await writeCredential(db, "CASE-1", "xero", cred({ expiresAt: null }), env);
    const token = await accessToken(db, "CASE-1", "xero", { env });
    expect(token).toBe("access-1");
  });

  test("a rotated refresh token is persisted before the access token is returned", async () => {
    // Xero's rotation: the token just spent is dead, so the replacement must be stored or
    // the connection is lost. Prove the NEW refresh token is what is now on disk.
    const now = new Date("2026-01-01T00:00:00Z");
    const expired = new Date(now.getTime() + 60_000).toISOString();
    await writeCredential(db, "CASE-1", "xero", cred({ expiresAt: expired }), env);

    const refresher = (old: string): Promise<Credential> => {
      expect(old).toBe("refresh-1");
      return Promise.resolve({
        accessToken: "access-2",
        refreshToken: "refresh-2",
        expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
      });
    };

    const token = await accessToken(db, "CASE-1", "xero", { refresher, now, env });
    expect(token).toBe("access-2");

    const stored = await readCredential(db, "CASE-1", "xero", { env });
    expect(stored.refreshToken).toBe("refresh-2");
  });

  test("an expired token with no refresher marks the connection expired and raises", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expired = new Date(now.getTime() + 60_000).toISOString();
    await writeCredential(
      db,
      "CASE-1",
      "xero",
      cred({ refreshToken: "", expiresAt: expired }),
      env,
    );

    await expect(accessToken(db, "CASE-1", "xero", { now, env })).rejects.toBeInstanceOf(
      ConnectionRegistryError,
    );
    const { rows } = await db.query<{ status: string }>(
      "SELECT status FROM ops.connection WHERE tenant_id = 'CASE-1' AND source = 'xero'",
    );
    expect(rows[0]?.status).toBe("expired");
  });
});
