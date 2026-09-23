import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { migrate } from "./migrate.ts";
import { createTestDatabase, type TestDatabase } from "./testing.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
});

afterEach(async () => {
  await db.close();
});

describe("migrations apply and are idempotent", () => {
  it("a fresh database applies every migration", async () => {
    const result = await migrate(db);
    expect(result.applied.length).toBeGreaterThanOrEqual(5);
    expect(result.skipped).toEqual([]);
  });

  it("a second run applies nothing", async () => {
    await migrate(db);
    const again = await migrate(db);
    expect(again.applied).toEqual([]);
    expect(again.skipped.length).toBeGreaterThanOrEqual(5);
  });

  it("the raw records table is partitioned by source", async () => {
    await migrate(db);
    const { rows } = await db.query<{ partstrat: string }>(
      `SELECT partstrat FROM pg_partitioned_table
       WHERE partrelid = 'raw.records'::regclass`,
    );
    // 'l' = LIST partitioning. A new connector adds a partition, not a migration.
    expect(rows[0]?.partstrat).toBe("l");
  });
});

/**
 * The boundary ADR 0036 draws, from both sides: a definition is restated on every run, a
 * change is not. Without both, "re-apply the repeatable files" is indistinguishable from
 * "re-apply everything", which is a far larger promise than this runner makes.
 */
describe("a repeatable file is restated on every run, a numbered one is not", () => {
  /** Whether a tenant's own dbt login may read the extracted text. */
  async function tenantMayReadText(): Promise<boolean> {
    const { rows } = await db.query<{ allowed: boolean }>(
      `SELECT has_table_privilege('undercroft_dbt_case_0042', 'raw.document_text', 'SELECT')
              AS allowed`,
    );
    return rows[0]?.allowed === true;
  }

  it("a tenant grant that has drifted is restored by the next migrate", async () => {
    // The production defect: `ops.provision_tenant` granted a tenant less than the rules by
    // then said, and nothing ever revisited a tenant already provisioned. A REVOKE reaches
    // that state in one statement rather than by reconstructing a stale function body.
    await migrate(db);
    await db.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-0042')");
    await db.query("SELECT ops.provision_tenant('CASE-0042')");
    await db.exec("REVOKE SELECT ON raw.document_text FROM undercroft_dbt_case_0042");
    expect(await tenantMayReadText()).toBe(false);

    await migrate(db);

    expect(await tenantMayReadText()).toBe(true);
  });

  it("a policy dropped from a numbered migration stays dropped", async () => {
    // The quiet side. 080 is a change, applied once: the runner does not restore it, and a
    // repair is a new migration. If this ever passes by being restored, the ledger has
    // stopped meaning what it says.
    await migrate(db);
    await db.exec("DROP POLICY tenant_own ON raw.records");

    await migrate(db);

    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_policies
       WHERE schemaname = 'raw' AND tablename = 'records' AND policyname = 'tenant_own'`,
    );
    expect(rows[0]?.n).toBe("0");
  });
});
