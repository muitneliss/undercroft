/**
 * Scope logins (ADR 0142), pinned in the gate: what `ops.provision_scope` grants a reader who
 * reaches only some models, what it never grants, how a promotion keeps it right, and when one
 * is swept away.
 *
 * PGlite proves the GRANTS -- `SET ROLE` stands in for the login. That a real connection as the
 * login reads no more, that `RESET ROLE` and `set_config` gain it nothing, and that the pooler
 * admits it, are the Docker tier's (`scopeLogins.integration.test.ts`).
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { provisionScope, rotateTenantPassword } from "./repos/tenantRoles.ts";
import { createMigratedTestDatabase, type TestDatabase } from "./testing.ts";

const TENANT = "CASE-0042";
const LOGIN = /^undercroft_bi_case_0042__[0-9a-f]{7}$/u;
const HOUR_MS = 60 * 60 * 1000;

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
  await db.query("SELECT ops.provision_tenant('CASE-0042')");
  await db.query("SELECT ops.provision_tenant('CASE-0043')");
  await db.asRole("undercroft_dbt_case_0042", async (tx) => {
    await tx.exec("CREATE TABLE analytics_case_0042.fct_sales AS SELECT 1 AS n");
    await tx.exec("CREATE TABLE analytics_case_0042.fct_costs AS SELECT 2 AS n");
    await tx.exec(
      "CREATE VIEW analytics_case_0042.v_sales AS SELECT * FROM analytics_case_0042.fct_costs",
    );
    await tx.exec("CREATE TABLE dq_case_0042.failures AS SELECT 3 AS n");
    await tx.exec("CREATE TABLE staging_case_0042.fct_sales AS SELECT 4 AS n");
  });
  await db.asRole("undercroft_dbt_case_0043", (tx) =>
    tx.exec("CREATE TABLE analytics_case_0043.fct_sales AS SELECT 5 AS n"),
  );
});

afterEach(async () => {
  await db.close();
});

/** What a statement was refused with, or `""` when it was not. */
async function refusalOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const DENIED = /permission denied/iu;

/** What asking for a scope login as `role` was refused with, or `""` when it was not. */
function provisionAs(role: string): Promise<string> {
  return refusalOf(() =>
    db.asRole(role, (tx) => tx.query("SELECT ops.provision_scope('CASE-0042', '{fct_sales}')")),
  );
}

describe("a scope login reads exactly its models' tables", () => {
  it("reads a granted table, and is refused an ungranted one, a view, dq, staging and raw", async () => {
    const login = await provisionScope(db, TENANT, ["fct_sales", "v_sales"]);

    expect(login).toMatch(LOGIN);
    const own = await db.asRole(login, (tx) =>
      tx.query<{ n: number }>("SELECT n FROM analytics_case_0042.fct_sales"),
    );
    expect(own.rows).toEqual([{ n: 1 }]);
    await db.asRole(login, async (tx) => {
      for (const sql of [
        "SELECT * FROM analytics_case_0042.fct_costs",
        // A view runs as its owner, so granting one would read whatever it reads: never granted.
        "SELECT * FROM analytics_case_0042.v_sales",
        "SELECT * FROM dq_case_0042.failures",
        "SELECT * FROM staging_case_0042.fct_sales",
        "SELECT * FROM raw.records",
        "SELECT * FROM analytics_case_0043.fct_sales",
        "SELECT * FROM ops.tenant_scope",
      ]) {
        expect(await refusalOf(() => tx.query(sql))).toMatch(DENIED);
      }
    });
  });

  it("is one login for one set, whatever the order or repeats, and another for another set", async () => {
    const first = await provisionScope(db, TENANT, ["fct_sales", "fct_costs"]);
    const same = await provisionScope(db, TENANT, ["fct_costs", "fct_sales", "fct_costs"]);
    const other = await provisionScope(db, TENANT, ["fct_sales"]);
    const elsewhere = await provisionScope(db, "CASE-0043", ["fct_sales", "fct_costs"]);

    expect(same).toBe(first);
    expect(other).not.toBe(first);
    expect(elsewhere).toMatch(/^undercroft_bi_case_0043__/u);
  });

  it("lists only its tables in information_schema, which is what bi.schema reads", async () => {
    const login = await provisionScope(db, TENANT, ["fct_sales"]);

    const { rows } = await db.asRole(login, (tx) =>
      tx.query<{ table_name: string }>(
        `SELECT DISTINCT table_name FROM information_schema.columns
         WHERE table_schema = 'analytics_case_0042' ORDER BY 1`,
      ),
    );

    expect(rows.map((row) => row.table_name)).toEqual(["fct_sales"]);
  });

  it("refuses a name that is not a model's, and a customer never provisioned", async () => {
    expect(await refusalOf(() => provisionScope(db, TENANT, ["fct,sales"]))).toContain(
      "names models by their names",
    );
    expect(await refusalOf(() => provisionScope(db, TENANT, ["fct_*"]))).toContain(
      "names models by their names",
    );
    expect(await refusalOf(() => provisionScope(db, "CASE-NONE", ["fct_sales"]))).toContain(
      "has no roles",
    );
  });

  it("cannot share a name with a customer's own login, because no slug holds two underscores", async () => {
    // A customer whose id read `case_0042__1a2b3c4` would fold to one underscore, so its BI login
    // is never the `undercroft_bi_<slug>__<hash>` shape every scope login has.
    const login = await provisionScope(db, TENANT, ["fct_sales"]);
    const { rows } = await db.query<{ slug: string }>("SELECT ops.tenant_slug($1) AS slug", [
      login.replace("undercroft_bi_", ""),
    ]);

    expect(login).toContain("__");
    expect(rows[0]?.slug).not.toContain("__");
  });
});

describe("a scope's grants stay right as tables come and go", () => {
  it("a table published later is granted by the promotion, before it moves, and travels with it", async () => {
    const login = await provisionScope(db, TENANT, ["fct_sales", "fct_new"]);
    await db.asRole("undercroft_dbt_case_0042", async (tx) => {
      await tx.exec("BEGIN");
      await tx.exec("CREATE TABLE staging_case_0042.fct_new AS SELECT 6 AS n");
      await tx.exec("CREATE TABLE staging_case_0042.fct_other AS SELECT 7 AS n");
      await tx.query("SELECT raw.grant_staged_to_scopes(current_user, $1::text[])", [
        ["fct_new", "fct_other"],
      ]);
      await tx.exec("ALTER TABLE staging_case_0042.fct_new SET SCHEMA analytics_case_0042");
      await tx.exec("ALTER TABLE staging_case_0042.fct_other SET SCHEMA analytics_case_0042");
      await tx.exec("COMMIT");
    });

    const published = await db.asRole(login, (tx) =>
      tx.query<{ n: number }>("SELECT n FROM analytics_case_0042.fct_new"),
    );
    expect(published.rows).toEqual([{ n: 6 }]);
    await db.asRole(login, async (tx) => {
      expect(
        await refusalOf(() => tx.query("SELECT * FROM analytics_case_0042.fct_other")),
      ).toMatch(DENIED);
    });
  });

  it("a republished table is granted again, and its old grant went with the old table", async () => {
    const login = await provisionScope(db, TENANT, ["fct_sales"]);
    await db.asRole("undercroft_dbt_case_0042", async (tx) => {
      await tx.exec("BEGIN");
      await tx.query("SELECT raw.grant_staged_to_scopes(current_user, $1::text[])", [
        ["fct_sales"],
      ]);
      await tx.exec("DROP TABLE analytics_case_0042.fct_sales RESTRICT");
      await tx.exec("ALTER TABLE staging_case_0042.fct_sales SET SCHEMA analytics_case_0042");
      await tx.exec("COMMIT");
    });

    const republished = await db.asRole(login, (tx) =>
      tx.query<{ n: number }>("SELECT n FROM analytics_case_0042.fct_sales"),
    );
    expect(republished.rows).toEqual([{ n: 4 }]);
  });

  it("a table remade outside a promotion is granted again at the scope's next session", async () => {
    const login = await provisionScope(db, TENANT, ["fct_sales"]);
    await db.asRole("undercroft_dbt_case_0042", (tx) =>
      tx.exec(`DROP TABLE analytics_case_0042.fct_sales;
               CREATE TABLE analytics_case_0042.fct_sales AS SELECT 9 AS n`),
    );
    await db.asRole(login, async (tx) => {
      expect(
        await refusalOf(() => tx.query("SELECT * FROM analytics_case_0042.fct_sales")),
      ).toMatch(DENIED);
    });

    expect(await provisionScope(db, TENANT, ["fct_sales"])).toBe(login);

    const again = await db.asRole(login, (tx) =>
      tx.query<{ n: number }>("SELECT n FROM analytics_case_0042.fct_sales"),
    );
    expect(again.rows).toEqual([{ n: 9 }]);
  });

  it("only a customer's own build login may ask for its scopes' grants", async () => {
    const asBi = await refusalOf(() =>
      db.asRole("undercroft_bi_case_0042", (tx) =>
        tx.query("SELECT raw.grant_staged_to_scopes(current_user, $1::text[])", [["fct_sales"]]),
      ),
    );
    const asAnother = await refusalOf(() =>
      db.asRole("undercroft_dbt_case_0043", (tx) =>
        tx.query("SELECT raw.grant_staged_to_scopes('undercroft_bi_case_0042', $1::text[])", [
          ["fct_sales"],
        ]),
      ),
    );

    expect(asBi).toMatch(DENIED);
    expect(asAnother).toContain("is not a customer's build login");
  });

  it("re-provisioning the customer restates every scope's grants on the tables there now", async () => {
    const login = await provisionScope(db, TENANT, ["fct_sales", "fct_late"]);
    await db.asRole("undercroft_dbt_case_0042", (tx) =>
      tx.exec("CREATE TABLE analytics_case_0042.fct_late AS SELECT 8 AS n"),
    );
    await db.asRole(login, async (tx) => {
      expect(await refusalOf(() => tx.query("SELECT * FROM analytics_case_0042.fct_late"))).toMatch(
        DENIED,
      );
    });

    await db.query("SELECT ops.provision_tenant($1)", [TENANT]);

    const late = await db.asRole(login, (tx) =>
      tx.query<{ n: number }>("SELECT n FROM analytics_case_0042.fct_late"),
    );
    expect(late.rows).toEqual([{ n: 8 }]);
  });
});

describe("a scope login's password and its end", () => {
  it("is leased like a tenant login's, for this customer's scope login only", async () => {
    const login = await provisionScope(db, TENANT, ["fct_sales"]);
    const other = await provisionScope(db, "CASE-0043", ["fct_sales"]);

    const password = await rotateTenantPassword(db, TENANT, { kind: "scope", login }, HOUR_MS);
    const borrowed = await refusalOf(() =>
      rotateTenantPassword(db, TENANT, { kind: "scope", login: other }, HOUR_MS),
    );
    const platform = await refusalOf(() =>
      rotateTenantPassword(db, TENANT, { kind: "scope", login: "undercroft_app" }, HOUR_MS),
    );

    expect(password).toMatch(/^[0-9a-f]{64}$/u);
    expect(borrowed).toContain("no scope login");
    expect(platform).toContain("no scope login");
    const { rows } = await db.query<{ usename: string }>("SELECT * FROM ops.pgbouncer_auth($1)", [
      login,
    ]);
    expect(rows.map((row) => row.usename)).toEqual([login]);
  });

  it("is swept once unused, passwordless and idle, and kept while any of those is untrue", async () => {
    const idle = await provisionScope(db, TENANT, ["fct_sales"]);
    const leased = await provisionScope(db, TENANT, ["fct_costs"]);
    const recent = await provisionScope(db, TENANT, ["fct_sales", "fct_costs"]);
    await rotateTenantPassword(db, TENANT, { kind: "scope", login: leased }, HOUR_MS);
    await db.exec(
      `UPDATE ops.tenant_scope SET last_used_at = now() - interval '8 days'
       WHERE role_name IN ('${idle}', '${leased}')`,
    );

    const { rows } = await db.query<{ dropped: number }>(
      "SELECT ops.drop_stale_scopes($1) AS dropped",
      [TENANT],
    );

    expect(rows).toEqual([{ dropped: 1 }]);
    const left = await db.query<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname",
      [[idle, leased, recent]],
    );
    expect(left.rows.map((row) => row.rolname)).toEqual([leased, recent].sort());
    expect((await db.query("SELECT * FROM ops.pgbouncer_auth($1)", [idle])).rows).toEqual([]);
    // The next reader of that set gets it back, granted, on their first read.
    expect(await provisionScope(db, TENANT, ["fct_sales"])).toBe(idle);
    const back = await db.asRole(idle, (tx) =>
      tx.query<{ n: number }>("SELECT n FROM analytics_case_0042.fct_sales"),
    );
    expect(back.rows).toEqual([{ n: 1 }]);
  });

  it("may be asked for by the worker alone", async () => {
    const refusals: string[] = [];
    for (const role of ["undercroft_app", "undercroft_bi_case_0042", "undercroft_dbt_case_0042"]) {
      refusals.push(await provisionAs(role));
    }
    expect(refusals.filter((refused) => DENIED.test(refused))).toHaveLength(3);
    const login = await db.asRole("undercroft_worker", (tx) =>
      provisionScope(tx, TENANT, ["fct_sales"]),
    );
    expect(login).toMatch(LOGIN);
  });
});

describe("a scope's row and column rules (ADR 0143)", () => {
  const PEOPLE = "analytics_case_0042.fct_people";
  const SALES = { column: "dept", op: "eq", values: ["Sales"] } as const;

  beforeEach(async () => {
    await db.asRole("undercroft_dbt_case_0042", (tx) =>
      tx.exec(`CREATE TABLE ${PEOPLE} AS
               SELECT * FROM (VALUES ('Sales', 1, 1000), ('Support', 2, 2000), (NULL, 7, 3000))
                 AS v(dept, region_id, salary)`),
    );
  });

  /** The departments a login reads of the table, in order; NULL as `null`. */
  async function deptsAs(login: string): Promise<(string | null)[]> {
    const { rows } = await db.asRole(login, (tx) =>
      tx.query<{ dept: string | null }>(`SELECT dept FROM ${PEOPLE} ORDER BY region_id`),
    );
    return rows.map((row) => row.dept);
  }

  it("shows a ruled login only its rows, while the BI login and an unruled scope read every one", async () => {
    const sales = await provisionScope(
      db,
      TENANT,
      ["fct_people"],
      [{ model: "fct_people", rows: [[SALES]], hidden: [] }],
    );
    const whole = await provisionScope(db, TENANT, ["fct_people"]);

    expect(await deptsAs(sales)).toEqual(["Sales"]);
    expect(await deptsAs(whole)).toEqual(["Sales", "Support", null]);
    expect(await deptsAs("undercroft_bi_case_0042")).toEqual(["Sales", "Support", null]);
    // The table's owner builds and tests it, and row security is not forced on it.
    expect(await deptsAs("undercroft_dbt_case_0042")).toEqual(["Sales", "Support", null]);
  });

  it("gives two scopes with different rules on one table each its own rows, and ORs one scope's rules", async () => {
    const sales = await provisionScope(
      db,
      TENANT,
      ["fct_people"],
      [{ model: "fct_people", rows: [[SALES]], hidden: [] }],
    );
    const either = await provisionScope(
      db,
      TENANT,
      ["fct_people"],
      [
        {
          model: "fct_people",
          rows: [
            [{ column: "dept", op: "eq", values: ["Support"] }],
            [{ column: "region_id", op: "in", values: ["7"] }],
          ],
          hidden: [],
        },
      ],
    );

    expect(sales).not.toBe(either);
    expect(await deptsAs(sales)).toEqual(["Sales"]);
    // `region_id` is an integer: the value '7' is compared as the integer 7, and matches the row
    // whose department is NULL, which no department rule ever does.
    expect(await deptsAs(either)).toEqual(["Support", null]);
  });

  it("refuses a hidden column named or through *, leaves it out of information_schema, and reads the rest", async () => {
    const staff = await provisionScope(
      db,
      TENANT,
      ["fct_people"],
      [{ model: "fct_people", rows: null, hidden: ["salary"] }],
    );

    await db.asRole(staff, async (tx) => {
      expect(await refusalOf(() => tx.query(`SELECT salary FROM ${PEOPLE}`))).toMatch(DENIED);
      expect(await refusalOf(() => tx.query(`SELECT * FROM ${PEOPLE}`))).toMatch(DENIED);
      const counted = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${PEOPLE}`);
      expect(counted.rows).toEqual([{ n: "3" }]);
      const columns = await tx.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'analytics_case_0042' AND table_name = 'fct_people' ORDER BY 1`,
      );
      expect(columns.rows.map((row) => row.column_name)).toEqual(["dept", "region_id"]);
    });
  });

  it("shows a rule naming a column the table lacks no row, and reports it, rather than every row", async () => {
    const broken = await provisionScope(
      db,
      TENANT,
      ["fct_people"],
      [
        {
          model: "fct_people",
          rows: [[{ column: "region", op: "eq", values: ["north"] }]],
          hidden: [],
        },
      ],
    );
    const mistyped = await provisionScope(
      db,
      TENANT,
      ["fct_people"],
      [
        {
          model: "fct_people",
          rows: [[{ column: "region_id", op: "eq", values: ["north"] }]],
          hidden: [],
        },
      ],
    );

    expect(await deptsAs(broken)).toEqual([]);
    expect(await deptsAs(mistyped)).toEqual([]);
    expect(await deptsAs("undercroft_bi_case_0042")).toHaveLength(3);
    const { rows } = await db.query<{ model: string; fault: string; columns: string[] }>(
      "SELECT * FROM ops.scope_faults($1, $2::text[], $3::jsonb) ORDER BY fault",
      [
        TENANT,
        ["fct_people"],
        JSON.stringify([
          {
            model: "fct_people",
            rows: [[{ column: "region", op: "eq", values: ["north"] }]],
            hidden: [],
          },
        ]),
      ],
    );
    expect(rows).toEqual([{ model: "fct_people", fault: "column-missing", columns: ["region"] }]);
  });

  it("keeps a republished table's policies and column grants, written before it moves", async () => {
    const sales = await provisionScope(
      db,
      TENANT,
      ["fct_people"],
      [{ model: "fct_people", rows: [[SALES]], hidden: ["salary"] }],
    );
    await db.asRole("undercroft_dbt_case_0042", async (tx) => {
      await tx.exec("BEGIN");
      await tx.exec(`CREATE TABLE staging_case_0042.fct_people AS
                     SELECT * FROM (VALUES ('Sales', 1, 9), ('Support', 2, 9), ('Sales', 3, 9))
                       AS v(dept, region_id, salary)`);
      await tx.query("SELECT raw.grant_staged_to_scopes(current_user, $1::text[])", [
        ["fct_people"],
      ]);
      await tx.exec(`DROP TABLE ${PEOPLE} RESTRICT`);
      await tx.exec("ALTER TABLE staging_case_0042.fct_people SET SCHEMA analytics_case_0042");
      await tx.exec("COMMIT");
    });

    expect(await deptsAs(sales)).toEqual(["Sales", "Sales"]);
    expect(await deptsAs("undercroft_bi_case_0042")).toEqual(["Sales", "Support", "Sales"]);
    await db.asRole(sales, async (tx) => {
      expect(await refusalOf(() => tx.query(`SELECT salary FROM ${PEOPLE}`))).toMatch(DENIED);
    });
  });

  it("restates a table's policies on re-provisioning without rewriting them, and drops them with their last scope", async () => {
    const sales = await provisionScope(
      db,
      TENANT,
      ["fct_people"],
      [{ model: "fct_people", rows: [[SALES]], hidden: [] }],
    );
    function policies(): Promise<{ rows: { oid: number; polname: string }[] }> {
      return db.query<{ oid: number; polname: string }>(
        `SELECT p.oid::int AS oid, p.polname FROM pg_policy p
         WHERE p.polrelid = '${PEOPLE}'::regclass ORDER BY p.polname`,
      );
    }
    const before = await policies();

    await db.query("SELECT ops.provision_tenant($1)", [TENANT]);

    expect((await policies()).rows).toEqual(before.rows);
    expect(before.rows.map((row) => row.polname)).toEqual([sales, "undercroft_open"].sort());

    await db.exec(
      `UPDATE ops.tenant_scope SET last_used_at = now() - interval '8 days' WHERE role_name = '${sales}'`,
    );
    await db.query("SELECT ops.provision_tenant($1)", [TENANT]);
    await provisionScope(db, TENANT, ["fct_people"]);

    expect((await policies()).rows).toEqual([]);
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE oid = '${PEOPLE}'::regclass`,
    );
    expect(rows).toEqual([{ relrowsecurity: false }]);
  });

  it("hashes the rules: one login for one set of rules in any order, another for other rules, and PR 3's for none", async () => {
    const plain = await provisionScope(db, TENANT, ["fct_people"]);
    const ruled = await provisionScope(
      db,
      TENANT,
      ["fct_people"],
      [
        {
          model: "fct_people",
          rows: [[SALES, { column: "region_id", op: "in", values: ["2", "1"] }]],
          hidden: ["salary"],
        },
      ],
    );
    const reordered = await provisionScope(
      db,
      TENANT,
      ["fct_people"],
      [
        {
          model: "fct_people",
          rows: [[{ column: "region_id", op: "in", values: ["1", "2", "1"] }, SALES]],
          hidden: ["salary", "salary"],
        },
      ],
    );
    const nothingNarrowed = await provisionScope(
      db,
      TENANT,
      ["fct_people"],
      [{ model: "fct_people", rows: null, hidden: [] }],
    );

    expect(ruled).not.toBe(plain);
    expect(reordered).toBe(ruled);
    expect(nothingNarrowed).toBe(plain);
    const { rows } = await db.query<{ hash: string }>(
      "SELECT encode(sha256(convert_to('undercroft.scope/1;models=fct_people', 'UTF8')), 'hex') AS hash",
    );
    expect(plain.endsWith(`__${(rows[0]?.hash ?? "").slice(0, 7)}`)).toBe(true);
  });

  it("refuses a rule that is not one, and a rule on a model outside the scope", async () => {
    expect(
      await refusalOf(() =>
        provisionScope(
          db,
          TENANT,
          ["fct_people"],
          [
            {
              model: "fct_people",
              rows: [[{ column: "dept; drop", op: "eq", values: ["x"] }]],
              hidden: [],
            },
          ],
        ),
      ),
    ).toContain("row rule");
    expect(
      await refusalOf(() =>
        provisionScope(
          db,
          TENANT,
          ["fct_people"],
          [{ model: "fct_sales", rows: null, hidden: ["n"] }],
        ),
      ),
    ).toContain("only a model of the scope");
  });
});
