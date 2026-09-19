/**
 * The Lake division over tRPC: the summary is every member's, the rows are an admin's.
 *
 * The guard is pinned from both sides -- a member is refused, an admin is answered -- because
 * a gate with only the refusing case can be satisfied by a procedure that refuses everyone.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { DEFAULT_LOCALE } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { appRouter } from "./router.ts";
import type { Context, Role } from "./trpc.ts";

const TENANT = "CASE-0042";

let db: TestDatabase;

async function seedMember(email: string, role: Role): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [email],
  );
  const userId = rows[0]?.id ?? "";
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    TENANT,
    userId,
    role,
  ]);
  return userId;
}

function caller(userId: string, email: string) {
  const ctx: Context = {
    exec: db,
    user: { userId, email },
    sessionId: "s1",
    superadmin: false,
    locale: DEFAULT_LOCALE,
    endSession: () => Promise.resolve(),
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () => Promise.resolve({ ok: false as const, reason: "not-configured" as const }),
    worker: null,
    googlePicker: null,
  };
  return appRouter.createCaller(ctx);
}

async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_ERROR";
  } catch (error) {
    return error instanceof TRPCError ? error.code : "UNKNOWN";
  }
}

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.query(
    `INSERT INTO raw.records (source, tenant_id, entity, source_record_id, payload,
       content_sha256, observed_at, lake_key, lake_stamp, run_id)
     VALUES ('hubspot', $1, 'deals', 'd-1', '{"name":"Acme"}'::jsonb, repeat('0', 64),
             '2026-09-18T08:00:00Z', 'k', 's', 'r-1')`,
    [TENANT],
  );
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("lake.summary", () => {
  it("a viewer reads what landed: counts, never a payload", async () => {
    const viewer = await seedMember("v@example.test", "viewer");
    const got = await caller(viewer, "v@example.test").lake.summary({ tenantId: TENANT });

    expect(got.records.map((s) => [s.entity, s.records])).toEqual([["deals", 1]]);
    expect(JSON.stringify(got)).not.toContain("Acme");
  });
});

describe("lake.records", () => {
  it("a member is refused: the rows are the source's data verbatim", async () => {
    const member = await seedMember("m@example.test", "member");
    const code = await errorCode(() =>
      caller(member, "m@example.test").lake.records({
        tenantId: TENANT,
        source: "hubspot",
        entity: "deals",
      }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("an admin pages the rows", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const page = await caller(admin, "a@example.test").lake.records({
      tenantId: TENANT,
      source: "hubspot",
      entity: "deals",
    });

    expect(page.items.map((r) => r.sourceRecordId)).toEqual(["d-1"]);
    expect(page.items[0]?.payload).toContain("Acme");
  });

  it("the document catalogue is gated the same way", async () => {
    const member = await seedMember("m@example.test", "member");
    const admin = await seedMember("a@example.test", "admin");

    expect(
      await errorCode(() =>
        caller(member, "m@example.test").lake.documents({ tenantId: TENANT, source: "gmail" }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await caller(admin, "a@example.test").lake.documents({ tenantId: TENANT, source: "gmail" }),
    ).toEqual({ items: [], nextCursor: null });
  });
});
