// biome-ignore-all lint/security/noSecrets: False positives. The rule flags high-entropy string literals, and these are test fixtures with invented values (per .claude/rules/pii.md, fixtures are invented rather than anonymised), plus base64url sample tokens and SQL role names. No real credential is in any tracked file; CI enforces that separately.

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { createTestDatabase, type TestDatabase } from "./testing.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
});

afterEach(async () => {
  await db.close();
});

describe("money-shaped types come back as strings", () => {
  it("numeric is a string, not a float", async () => {
    // The whole point: a numeric(18,4) that arrives as a JS number has already lost
    // precision past a double, and one careless read turns it into a float.
    const { rows } = await db.query<{ amount: string }>(
      "SELECT 8500.0001::numeric(18,4) AS amount",
    );
    expect(typeof rows[0]?.amount).toBe("string");
    expect(rows[0]?.amount).toBe("8500.0001");
  });

  it("a 25-digit numeric survives", async () => {
    const { rows } = await db.query<{ big: string }>(
      "SELECT 1234567890123456789012345::numeric AS big",
    );
    expect(rows[0]?.big).toBe("1234567890123456789012345");
  });

  it("int8 is never a lossy float, so a large id is not rounded", async () => {
    // The rule is "never a float", not "always a string". PGlite returns int8 as a JS
    // `bigint` (exact); `pg` returns it as a string via the pinned parser. Both are
    // lossless. This gate test asserts the safety property that holds in both; the
    // pg-specific string representation is pinned in the integration tier against real
    // Postgres, where a future pg default could otherwise flip it to a double.
    const { rows } = await db.query<{ id: string | bigint }>(
      "SELECT 90071992547409911::int8 AS id",
    );
    const id = rows[0]?.id;
    expect(typeof id).not.toBe("number");
    expect(String(id)).toBe("90071992547409911");
  });
});
