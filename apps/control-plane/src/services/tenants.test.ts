/**
 * Creating a customer brings its database roles into existence with it, or does not
 * happen at all.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { create } from "./tenants.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  // As the control plane: provisioning a tenant's roles is a privilege it must actually hold.
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("tenants.create", () => {
  it("a new customer gets its two roles and two schemas in the same call", async () => {
    const result = await create(db, {
      tenantId: "CASE-0042",
      displayName: "Acme",
      actor: "ops@example.test",
    });
    expect(result.ok).toBe(true);

    const { rows } = await db.query<{ role_name: string }>(
      "SELECT role_name FROM ops.tenant_role WHERE tenant_id = 'CASE-0042' ORDER BY role_name",
    );
    expect(rows.map((r) => r.role_name)).toEqual([
      "undercroft_bi_case_0042",
      "undercroft_dbt_case_0042",
    ]);
  });

  it("a reference that folds to an existing customer's login is refused, and leaves no row", async () => {
    await create(db, { tenantId: "CASE-0042", displayName: "Acme", actor: "ops@example.test" });

    const result = await create(db, {
      tenantId: "case_0042",
      displayName: "Acme again",
      actor: "ops@example.test",
    });
    expect(result).toEqual({ ok: false, reason: "role-collision" });

    const { rows } = await db.query<{ id: string }>("SELECT id FROM ops.tenant ORDER BY id");
    expect(rows.map((r) => r.id)).toEqual(["CASE-0042"]);
  });

  it("a reference already in use is still reported as such, not as a collision", async () => {
    await create(db, { tenantId: "CASE-0042", displayName: "Acme", actor: "ops@example.test" });
    const result = await create(db, {
      tenantId: "CASE-0042",
      displayName: "Acme",
      actor: "ops@example.test",
    });
    expect(result).toEqual({ ok: false, reason: "already-exists" });
  });
});
