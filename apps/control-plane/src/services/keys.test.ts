/**
 * What an ingest key promises: the token is handed out once and stored as a digest, the
 * list never carries it, a revoked key stays listed as revoked, and the trail names the key
 * and never the token.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { hashToken } from "@undercroft/crypto";
import { findByDigest } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { list, mint, revoke } from "./keys.ts";

const TENANT = "CASE-0042";
const NOW = new Date("2026-09-19T10:00:00.000Z");
/** `uk_` and eight base64url characters: the shape a support conversation can read out. */
const KEY_ID = /^uk_[A-Za-z0-9_-]{8}$/u;

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1), ('CASE-0043')", [TENANT]);
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("minting", () => {
  it("hands the token out once, prefixed by its id, and stores only a digest of it", async () => {
    const minted = await mint(db, {
      tenantId: TENANT,
      label: "Kestra feed",
      allowedSources: ["hubspot"],
      expiresInDays: 30,
      actor: "ada@example.test",
      now: NOW,
    });

    expect(minted.id).toMatch(KEY_ID);
    expect(minted.token.startsWith(`${minted.id}.`)).toBe(true);
    expect(minted.expiresAt).toBe("2026-10-19T10:00:00.000Z");

    // The worker finds it by the digest of the whole token; the row holds no token.
    const row = await findByDigest(db, hashToken(minted.token));
    expect(row?.id).toBe(minted.id);
    expect(row?.allowed_sources).toEqual(["hubspot"]);
    // Unrevoked, so the worker's rule admits it -- the quiet half of the revoke test below.
    expect(row?.revoked_at).toBeNull();
    const { rows } = await db.query<{ token_sha256: string }>(
      "SELECT token_sha256 FROM app.ingest_key WHERE id = $1",
      [minted.id],
    );
    expect(rows[0]?.token_sha256).not.toContain(minted.token.slice(-10));
  });

  it("the list names the key and never its token; the trail likewise", async () => {
    const minted = await mint(db, {
      tenantId: TENANT,
      label: "Kestra feed",
      allowedSources: [],
      actor: "ada@example.test",
    });

    const keys = await list(db, TENANT);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({
      id: minted.id,
      label: "Kestra feed",
      allowedSources: [],
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });
    expect(JSON.stringify(keys)).not.toContain(minted.token.slice(-10));

    const { rows } = await db.query<{ action: string; detail: unknown }>(
      "SELECT action, detail FROM ops.audit_log",
    );
    expect(rows[0]?.action).toBe("keys.mint");
    expect(JSON.stringify(rows[0]?.detail)).toContain(minted.id);
    expect(JSON.stringify(rows[0]?.detail)).not.toContain(minted.token.slice(-10));
  });
});

describe("revoking", () => {
  it("a revoked key stays listed as revoked and is no longer found by the worker's lookup rule", async () => {
    const minted = await mint(db, {
      tenantId: TENANT,
      label: "Old feed",
      allowedSources: [],
      actor: "ada@example.test",
    });

    expect(await revoke(db, { tenantId: TENANT, id: minted.id, actor: "ada@example.test" })).toBe(
      true,
    );
    expect((await list(db, TENANT))[0]?.revokedAt).not.toBeNull();
    // The worker's rule (`apps/worker/src/services/auth.ts`) looks the key up by the token's
    // digest and refuses a row whose `revoked_at` is set. So the row it finds is the revoked
    // one -- still there, which is what keeps it listed above -- and it is refused.
    const seen = await findByDigest(db, hashToken(minted.token));
    expect(seen?.id).toBe(minted.id);
    expect(seen?.revoked_at).not.toBeNull();
    // Revoking twice, or from another tenant, revokes nothing and says so.
    expect(await revoke(db, { tenantId: TENANT, id: minted.id, actor: "ada@example.test" })).toBe(
      false,
    );
  });

  it("another tenant cannot revoke it", async () => {
    const minted = await mint(db, {
      tenantId: TENANT,
      label: "Feed",
      allowedSources: [],
      actor: "ada@example.test",
    });

    expect(
      await revoke(db, { tenantId: "CASE-0043", id: minted.id, actor: "eve@example.test" }),
    ).toBe(false);
    expect((await list(db, TENANT))[0]?.revokedAt).toBeNull();
  });
});
