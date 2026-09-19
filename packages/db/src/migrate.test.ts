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
