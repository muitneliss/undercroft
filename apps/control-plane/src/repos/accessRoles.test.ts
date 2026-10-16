/**
 * What the database itself refuses about roles and grants (`600_custom_roles.sql`, ADR 0141), as
 * `undercroft_app` writing rows directly -- the way `bun run invite` or any later writer would,
 * with no service in front of it. These are the guarantees that hold whoever writes.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { BUILT_IN_ROLES } from "@undercroft/contracts/access";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

let db: TestDatabase;
let userId: string;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.become("undercroft_app");
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ('p@example.test') RETURNING id",
  );
  userId = rows[0]?.id ?? "";
});

afterEach(async () => {
  await db.close();
});

/** The error a statement raised, or `null` when it succeeded. */
async function failure(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const JOIN = "INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)";

describe("every customer has the built-in roles", () => {
  it("a customer inserted directly gets exactly the keys code calls built-in", async () => {
    const { rows } = await db.query<{ key: string }>(
      `SELECT key FROM app.access_role WHERE tenant_id = 'CASE-0042' AND builtin
       ORDER BY array_position($1::text[], key)`,
      [[...BUILT_IN_ROLES]],
    );

    expect(rows.map((row) => row.key)).toEqual([...BUILT_IN_ROLES]);
  });
});

describe("a membership names a role its customer has", () => {
  it("is refused at a key the customer lacks, and at another customer's own role", async () => {
    await db.query(
      "INSERT INTO app.access_role (tenant_id, key, label, permissions) VALUES ('CASE-0043', 'auditor', 'Auditor', '{}')",
    );

    expect(await failure(JOIN, ["CASE-0042", userId, "auditor"])).toContain("foreign key");
    expect(await failure(JOIN, ["CASE-0042", userId, "owner"])).toContain("foreign key");
  });

  it("is accepted at a built-in, and at a role the customer defined", async () => {
    await db.query(
      "INSERT INTO app.access_role (tenant_id, key, label, permissions) VALUES ('CASE-0042', 'auditor', 'Auditor', '{}')",
    );

    expect(await failure(JOIN, ["CASE-0042", userId, "auditor"])).toBeNull();
    expect(await failure(JOIN, ["CASE-0043", userId, "viewer"])).toBeNull();
  });

  it("keeps a role somebody holds from being deleted, by any writer", async () => {
    await db.query(
      "INSERT INTO app.access_role (tenant_id, key, label, permissions) VALUES ('CASE-0042', 'auditor', 'Auditor', '{}')",
    );
    await db.query(JOIN, ["CASE-0042", userId, "auditor"]);

    expect(
      await failure(
        "DELETE FROM app.access_role WHERE tenant_id = 'CASE-0042' AND key = 'auditor'",
      ),
    ).toContain("foreign key");
  });

  it("does not keep a customer from being deleted whole, its members and roles with it", async () => {
    await db.query(JOIN, ["CASE-0042", userId, "admin"]);

    expect(await failure("DELETE FROM ops.tenant WHERE id = 'CASE-0042'")).toBeNull();
  });
});

describe("a customer's own role is never a built-in", () => {
  it("cannot take a built-in's key, nor can a built-in carry permissions", async () => {
    await db.query("DELETE FROM app.access_role WHERE tenant_id = 'CASE-0043' AND key = 'admin'");

    expect(
      await failure(
        "INSERT INTO app.access_role (tenant_id, key, label, permissions) VALUES ('CASE-0043', 'admin', 'Mine', '{}')",
      ),
    ).toContain("access_role_builtin_keys");
    expect(
      await failure(
        "UPDATE app.access_role SET permissions = '{models:write}' WHERE tenant_id = 'CASE-0042' AND key = 'viewer'",
      ),
    ).toContain("access_role_builtin_grants_in_code");
  });

  it("cannot hold a colon, which would read as a person's subject", async () => {
    expect(
      await failure(
        "INSERT INTO app.access_role (tenant_id, key, label, permissions) VALUES ('CASE-0042', 'user:x', 'X', '{}')",
      ),
    ).toContain("check constraint");
  });
});

describe("a grant is a permission, once", () => {
  const GRANT = `INSERT INTO app.access_grant (tenant_id, subject_kind, role_key, object, action)
                 VALUES ('CASE-0042', 'role', 'member', $1, $2)`;

  it("refuses a pattern, an object that is not a permission, and an action other than use", async () => {
    expect(await failure(GRANT, ["perm:*", "use"])).toContain("access_grant_permission_only");
    expect(await failure(GRANT, ["model:orders", "read"])).toContain(
      "access_grant_permission_only",
    );
    expect(await failure(GRANT, ["perm:lake:read", "write"])).toContain(
      "access_grant_permission_only",
    );
  });

  it("is stored once per subject, and accepted the first time", async () => {
    expect(await failure(GRANT, ["perm:lake:read", "use"])).toBeNull();
    expect(await failure(GRANT, ["perm:lake:read", "use"])).toContain("access_grant_once");
  });

  it("to a person, needs them to be a member of that customer", async () => {
    const grant = `INSERT INTO app.access_grant (tenant_id, subject_kind, user_id, object, action)
                   VALUES ($1, 'user', $2, 'perm:lake:read', 'use')`;
    await db.query(JOIN, ["CASE-0043", userId, "viewer"]);

    expect(await failure(grant, ["CASE-0042", userId])).toContain("foreign key");
    expect(await failure(grant, ["CASE-0043", userId])).toBeNull();
  });
});
