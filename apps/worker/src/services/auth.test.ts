/**
 * What admitting a caller by ingest key records: that the key was used, once a minute rather
 * than once a request, and nothing at all for a key that was refused.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { hashToken } from "@undercroft/crypto";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { authenticate, resetKeyUseThrottle } from "./auth.ts";

const TOKEN = "uk_abcd1234.a-token-nobody-else-holds";
const T0 = new Date("2026-09-19T10:00:00.000Z");

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
  await db.query(
    `INSERT INTO app.ingest_key (id, token_sha256, tenant_id, label, allowed_sources)
     VALUES ('uk_abcd1234', $1, 'CASE-1', 'Kestra feed', '{hubspot}')`,
    [hashToken(TOKEN)],
  );
  await db.become("undercroft_worker");
  resetKeyUseThrottle();
});

afterEach(async () => {
  await db.close();
});

async function lastUsed(): Promise<string | null> {
  const { rows } = await db.query<{ last_used_at: Date | string | null }>(
    "SELECT last_used_at FROM app.ingest_key WHERE id = 'uk_abcd1234'",
  );
  const value = rows[0]?.last_used_at ?? null;
  return value === null ? null : new Date(value).toISOString();
}

function admit(now: Date, source = "hubspot") {
  return authenticate(db, TOKEN, { serviceToken: "", tenantId: "CASE-1", source, now });
}

describe("a key that admitted a caller", () => {
  it("is recorded as used, once a minute rather than once a request", async () => {
    expect((await admit(T0)).ok).toBe(true);
    expect(await lastUsed()).toBe(T0.toISOString());

    // Thirty seconds later: admitted again, not written again.
    const soon = new Date(T0.getTime() + 30_000);
    expect((await admit(soon)).ok).toBe(true);
    expect(await lastUsed()).toBe(T0.toISOString());

    // Past the minute: written again.
    const later = new Date(T0.getTime() + 61_000);
    expect((await admit(later)).ok).toBe(true);
    expect(await lastUsed()).toBe(later.toISOString());
  });

  it("a key used outside its scope is refused and not recorded as used", async () => {
    // The quiet side: a refusal is not a use.
    const outcome = await admit(T0, "xero");

    expect(outcome.ok).toBe(false);
    expect(await lastUsed()).toBeNull();
  });
});
