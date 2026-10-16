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

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { bindParams, compileVisual } from "@undercroft/contracts";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { exportQuery } from "./queryExport.ts";
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
  db = await createMigratedTestDatabase();
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

  it("names the tables its plan read, as the BI login: through a CTE and a join, never a name in a string", async () => {
    // Issue 456: the control plane qualifies an answer by what it read, so this must be exact.
    await db.asRole("undercroft_dbt_case_1", (tx) =>
      tx.exec(
        "CREATE TABLE analytics_case_1.dim_owner AS SELECT 1 AS deal_id, 'Ada'::text AS owner",
      ),
    );
    const joined = await runQuery(deps, {
      tenantId: TENANT,
      sql: `with d as (select deal_id from stg_deals where deal_id > 0)
            select d.deal_id, o.owner, 'fct_pipeline' as named_not_read
            from d join dim_owner o using (deal_id)`,
      limit: 10,
    });
    expect(joined.rows).toEqual([[1, "Ada", "fct_pipeline"]]);
    expect(joined.relations).toEqual(["dim_owner", "stg_deals"]);

    const nothing = await runQuery(deps, {
      tenantId: TENANT,
      sql: "select 'stg_deals' as name",
      limit: 1,
    });
    expect(nothing.relations).toEqual([]);
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

describe("exportQuery", () => {
  it("streams every row past a dashboard's cap, each figure as the database sent it", async () => {
    const stream = await exportQuery(deps, {
      tenantId: TENANT,
      sql: "select n, (n * 1.5)::numeric(18,4) as amount from generate_series(1, 12001) as n order by n",
    });
    // The bytes as a spreadsheet gets them: `Response#text()` would drop the byte-order mark.
    const bytes = await new Response(stream).arrayBuffer();
    const lines = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).split("\r\n");

    expect(lines[0]).toBe("﻿n,amount");
    // A header, 12,001 rows -- more than twice MAX_QUERY_ROWS -- and the CRLF after the last.
    expect(lines).toHaveLength(12_003);
    expect(lines[1]).toBe("1,1.5000");
    expect(lines[12_001]).toBe("12001,18001.5000");
  });

  it("refuses SQL Postgres refuses before the first byte, with Postgres's sentence", async () => {
    const message = await refusal(() =>
      exportQuery(deps, { tenantId: TENANT, sql: "select * from nope" }),
    );
    expect(message).toContain('relation "nope" does not exist');
  });

  it("a failure after the first byte cuts the stream rather than ending the file early", async () => {
    // Row 1,500 divides by zero: the first batch of 1,000 is already on its way when it fails.
    const stream = await exportQuery(deps, {
      tenantId: TENANT,
      sql: "select 1 / (n - 1500) as x from generate_series(1, 3000) as n",
    });
    let read: string | null = null;
    try {
      read = await new Response(stream).text();
    } catch {
      // The body failed, which is the promise: no client may take what came first for a file.
    }
    expect(read).toBeNull();
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

describe("a read under a scope (ADR 0142)", () => {
  beforeEach(async () => {
    await db.asSuperuser((tx) =>
      tx.exec(
        "SET ROLE undercroft_dbt_case_1; CREATE TABLE analytics_case_1.stg_other AS SELECT 9 AS n; RESET ROLE",
      ),
    );
  });

  it("answers from the scope's tables, and is refused another in Postgres's words", async () => {
    const scope = { models: ["stg_deals"] };

    const own = await runQuery(deps, {
      tenantId: TENANT,
      sql: "select count(*)::int as n from stg_deals",
      limit: 10,
      scope,
    });
    const other = await refusal(() =>
      runQuery(deps, { tenantId: TENANT, sql: "select * from stg_other", limit: 10, scope }),
    );
    // Moving the search path from inside the author's SQL changes which name resolves, never
    // which table the login may read.
    const moved = await refusal(() =>
      runQuery(deps, {
        tenantId: TENANT,
        sql: "select * from (select set_config('search_path', 'analytics_case_1,public', true)) s, stg_other",
        limit: 10,
        scope,
      }),
    );

    expect(own.rows).toEqual([[3]]);
    expect(other).toMatch(/permission denied/u);
    expect(moved).toMatch(/permission denied/u);
  });

  it("lists only the scope's tables in its schema, and the BI login lists every one", async () => {
    const scoped = await readSchema(deps, { tenantId: TENANT, scope: { models: ["stg_deals"] } });
    const whole = await readSchema(deps, { tenantId: TENANT, scope: null });

    expect(scoped.tables.map((table) => table.name)).toEqual(["stg_deals"]);
    expect(whole.tables.map((table) => table.name)).toEqual(["stg_deals", "stg_other"]);
  });
});
