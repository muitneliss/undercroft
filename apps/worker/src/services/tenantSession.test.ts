/**
 * What holding a tenant's login promises: while one caller holds it, no other caller of the
 * same login changes its password (ADR 0087). A Postgres role has one password, so a change
 * refuses every login still to be made with the old one -- which is how a raw-lake query opened
 * while `dbt build` was parsing locked the build out of its own login.
 *
 * "Changed" is read where Postgres keeps it: the role's verifier in `pg_authid`. PGlite has no
 * authentication, so an unchanged verifier is the whole of what a later login depends on.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { provisionTenantRoles } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { sessionsBySetRole, type TenantSessions } from "./tenantSession.ts";

const DBT = { tenantId: "CASE-1", kind: "dbt" } as const;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

let db: TestDatabase;
let sessions: TenantSessions;

/** The dbt login's stored password verifier, and whether it still authenticates `forMs` on. */
async function login(forMs = 0): Promise<{ verifier: string | null; lasts: boolean }> {
  const { rows } = await db.asSuperuser((tx) =>
    tx.query<{ verifier: string | null; lasts: boolean }>(
      `SELECT rolpassword AS verifier,
              rolvaliduntil > clock_timestamp() + ($1 || ' milliseconds')::interval AS lasts
       FROM pg_authid WHERE rolname = 'undercroft_dbt_case_1'`,
      [String(forMs)],
    ),
  );
  return { verifier: rows[0]?.verifier ?? null, lasts: rows[0]?.lasts ?? false };
}

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [DBT.tenantId]);
  await provisionTenantRoles(db, DBT.tenantId);
  await db.become("undercroft_worker");
  sessions = sessionsBySetRole(db, (role, fn) => db.asRole(role, fn));
});

afterEach(async () => {
  await db.close();
});

describe("holding a tenant's login", () => {
  it("a caller that overlaps a held login shares its password and does not change it", async () => {
    await sessions.withPassword(DBT, MINUTE_MS, async (held) => {
      const before = await login();
      const joined = await sessions.withPassword(DBT, MINUTE_MS, (password) =>
        Promise.resolve(password),
      );

      expect(joined).toBe(held);
      expect((await login()).verifier).toBe(before.verifier);
    });
  });

  it("a caller that needs the login longer than it has left extends it, keeping the password", async () => {
    await sessions.withPassword(DBT, MINUTE_MS, async () => {
      const before = await login();
      await sessions.withPassword(DBT, 3 * HOUR_MS, () => Promise.resolve());
      const after = await login(3 * HOUR_MS);

      expect(after.verifier).toBe(before.verifier);
      expect(after.lasts).toBe(true);
    });
  });
});
