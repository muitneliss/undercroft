/**
 * What the query runner promises, proven on the grants rather than on a filter: as the
 * tenant's read-only login a SELECT over its own analytics schema answers with typed
 * columns and a numeric that is a string; the page is cut at the limit and says so; a read
 * of `raw`, a write, a second statement and another tenant's schema are each refused with
 * Postgres's own sentence; and the schema read lists what the login can see.
 *
 * PGlite steps into the role with SET ROLE (see `tenantSession.ts`); the login itself is
 * proven against real Postgres in the Docker tier.
 */

// biome-ignore-all lint/security/noSecrets: False positives. The rule flags high-entropy string literals, and these are test fixtures with invented values (per .claude/rules/pii.md, fixtures are invented rather than anonymised), plus base64url sample tokens and SQL role names. No real credential is in any tracked file; CI enforces that separately.

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { bindParams, compileVisual } from "@undercroft/contracts";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { QueryFailed, type QueryDeps, readSchema, runQuery } from "./queryRunner.ts";
import { sessionsBySetRole } from "./tenantSession.ts";

const TENANT = "CASE-1";
/** How Postgres words a write inside a read-only transaction, or a statement it cannot parse. */
const REFUSED_WRITE = /read-only|syntax/u;

let db: TestDatabase;
let deps: QueryDeps;

async function refusal(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof QueryFailed) {
      return error.message;
    }
    throw error;
  }
  throw new Error("expected the query to be refused");
}

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1), ('CASE-2')", [TENANT]);
  await db.query("SELECT ops.provision_tenant($1)", [TENANT]);
  await db.query("SELECT ops.provision_tenant('CASE-2')");
  // What dbt would have built, as the login dbt would be, for both tenants.
  await db.asRole("undercroft_dbt_case_1", (tx) =>
    tx.exec(`CREATE TABLE analytics_case_1.stg_deals AS
      SELECT 1 AS deal_id, 'Acme'::text AS deal_name, 12345678901234.5678::numeric(18,4) AS amount
      UNION ALL SELECT 2, 'Globex', 10.0000
      UNION ALL SELECT 3, NULL, NULL`),
  );
  await db.asRole("undercroft_dbt_case_2", (tx) =>
    tx.exec("CREATE TABLE analytics_case_2.stg_theirs AS SELECT 'theirs'::text AS who"),
  );
  await db.become("undercroft_worker");
  deps = { exec: db, sessions: sessionsBySetRole(db, (role, fn) => db.asRole(role, fn)) };
});

afterEach(async () => {
  await db.close();
});

describe("runQuery", () => {
  it("answers a SELECT over the tenant's own schema with typed columns; numeric is a string", async () => {
    const result = await runQuery(deps, {
      tenantId: TENANT,
      sql: "select deal_id, deal_name, amount from stg_deals order by deal_id;",
      limit: 10,
    });

    expect(result.columns).toEqual([
      { name: "deal_id", type: "integer" },
      { name: "deal_name", type: "text" },
      { name: "amount", type: "numeric" },
    ]);
    expect(result.rows).toEqual([
      [1, "Acme", "12345678901234.5678"],
      [2, "Globex", "10.0000"],
      [3, null, null],
    ]);
    expect(result.truncated).toBe(false);
  });

  it("cuts the page at the limit and says so", async () => {
    const result = await runQuery(deps, {
      tenantId: TENANT,
      sql: "select deal_id from stg_deals order by deal_id",
      limit: 2,
    });
    expect(result.rows).toEqual([[1], [2]]);
    expect(result.truncated).toBe(true);
  });

  it("cannot read raw, cannot write, and cannot see another tenant's schema", async () => {
    expect(
      await refusal(() =>
        runQuery(deps, { tenantId: TENANT, sql: "select * from raw.records", limit: 10 }),
      ),
    ).toContain("permission denied");
    expect(
      await refusal(() =>
        runQuery(deps, {
          tenantId: TENANT,
          sql: "select * from analytics_case_2.stg_theirs",
          limit: 10,
        }),
      ),
    ).toContain("permission denied");
    // A write inside a read-only transaction is refused by the transaction, before any grant.
    expect(
      await refusal(() =>
        runQuery(deps, {
          tenantId: TENANT,
          sql: "create table analytics_case_1.x as select 1",
          limit: 10,
        }),
      ),
    ).toMatch(REFUSED_WRITE);
  });

  it("a second statement after the SELECT is a syntax error, not a second statement", async () => {
    const message = await refusal(() =>
      runQuery(deps, {
        tenantId: TENANT,
        sql: "select 1; drop table analytics_case_1.stg_deals",
        limit: 10,
      }),
    );
    expect(message).toContain("syntax error");
    // The table is still there, readable by the same login.
    const after = await runQuery(deps, {
      tenantId: TENANT,
      sql: "select count(*)::int as n from stg_deals",
      limit: 1,
    });
    expect(after.rows).toEqual([[3]]);
  });
});

describe("a compiled question", () => {
  it("runs as the tenant's login exactly as the compiler wrote it", async () => {
    const sql = bindParams(
      compileVisual({
        kind: "visual",
        table: "stg_deals",
        fields: [
          { column: "*", aggregate: "count", alias: "deals" },
          { column: "amount", aggregate: "sum" },
        ],
        filters: [{ column: "amount", op: "gte", value: "{{floor}}" }],
        groupBy: [],
        orderBy: [],
        limit: 10,
      }),
      { floor: "10" },
    );
    const result = await runQuery(deps, { tenantId: TENANT, sql, limit: 10 });
    expect(result.columns.map((c) => c.name)).toEqual(["deals", "sum_amount"]);
    expect(result.rows).toEqual([[2, "12345678901244.5678"]]);
  });
});

describe("readSchema", () => {
  it("lists the tenant's tables and columns with their types, and nobody else's", async () => {
    const schema = await readSchema(deps, { tenantId: TENANT });
    expect(schema.tables).toEqual([
      {
        name: "stg_deals",
        columns: [
          { name: "deal_id", type: "integer" },
          { name: "deal_name", type: "text" },
          { name: "amount", type: "numeric" },
        ],
      },
    ]);
  });
});
