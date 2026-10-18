/**
 * The Docker tier of the isolation model: a real login, not a `SET ROLE`.
 *
 * `privileges.test.ts` proves the grants and the row-level policies in PGlite, where the
 * session user is a superuser and `SET ROLE` stands in for a login. What PGlite cannot
 * prove is the half that matters most in production: that a connection opened AS a
 * tenant's role with a rotated password sees only its tenant, and that `RESET ROLE` --
 * which a customer's SQL may issue -- changes nothing, because there is no more privileged
 * session to fall back to. That needs real authentication, so it runs against the compose
 * Postgres and is skipped by the offline gate.
 *
 *   task ci:itest        # reads deploy/compose/.env, starts Postgres and the tenant pooler
 *
 * The pooler's half (ADR 0088) is here for the same reason: tenant passwords rotate, PgBouncer
 * learns each login's secret from `ops.pgbouncer_auth` at every client login, and only a real
 * SCRAM exchange shows that the current password gets in and nothing else does.
 *
 * The scope logins' half (ADR 0142) is here for the same reason: what a scope login reads is a
 * grant, which PGlite proves; that a connection AS it cannot `RESET ROLE` or `set_config` its way to
 * more, that a republish inside a promotion leaves no instant a reader is refused or over-served,
 * and that the pooler admits it and stops admitting it once it is dropped, need the real thing.
 *
 * The tenant it creates, `CASE-ITEST`, is left in place: the test is idempotent, and a
 * developer's database is theirs to reset.
 */

import { describe, expect, test as it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
// biome-ignore lint/correctness/noUnresolvedImports: `pg` is CommonJS; its default export is the namespace, which Biome's resolver does not model. tsc does, with esModuleInterop.
import pg from "pg";

import { migrate, setRolePassword } from "./migrate.ts";
import { asExecutor } from "./pool.ts";
import {
  extendTenantPassword,
  provisionScope,
  provisionTenantRoles,
  rotateTenantPassword,
} from "./repos/tenantRoles.ts";

// biome-ignore lint/style/noProcessEnv: The integration tier gates itself on the env var that turns it on. A suite is its own composition root -- `layering.md`.
const ENABLED = process.env.UNDERCROFT_ITEST === "1";
const TENANT = "CASE-ITEST";
const OTHER = "CASE-ITEST-OTHER";
const DENIED = /permission denied/iu;
const HOUR_MS = 60 * 60 * 1000;
/** PgBouncer's refusals: a wrong proof, or a login `ops.pgbouncer_auth` gave no secret for. */
const REFUSED = /SASL authentication failed|password authentication failed|no such user/iu;

/** `deploy/compose/.env`, the one file that knows the dev Postgres's password and port. */
function composeEnv(): Record<string, string> {
  const path = join(import.meta.dirname, "..", "..", "..", "deploy", "compose", ".env");
  if (!existsSync(path)) {
    throw new Error(`${path} does not exist; copy .env.example and start the compose stack`);
  }
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    const eq = trimmed.indexOf("=");
    if (!trimmed.startsWith("#") && eq > 0) {
      env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  }
  return env;
}

function connection(): { host: string; port: number; database: string; admin: pg.PoolConfig } {
  const env = composeEnv();
  const host = "127.0.0.1";
  const port = Number.parseInt(env.UNDERCROFT_PORT_POSTGRES ?? "15432", 10);
  const database = env.UNDERCROFT_PG_DB ?? "undercroft";
  return {
    host,
    port,
    database,
    admin: {
      host,
      port,
      database,
      user: env.UNDERCROFT_PG_USER ?? "undercroft",
      password: env.UNDERCROFT_PG_PASSWORD ?? "",
    },
  };
}

async function refusalOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (error) {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

describe.skipIf(!ENABLED)("a tenant's login, against real Postgres", () => {
  it("sees only its own tenant, and RESET ROLE gives it nothing more", async () => {
    const conn = connection();
    const admin = new pg.Pool({ ...conn.admin, max: 2 });
    const exec = asExecutor(admin);
    try {
      await migrate(exec);
      await exec.query(
        "INSERT INTO ops.tenant (id) VALUES ($1), ($2) ON CONFLICT (id) DO NOTHING",
        [TENANT, OTHER],
      );
      await provisionTenantRoles(exec, TENANT);
      await provisionTenantRoles(exec, OTHER);
      await exec.query(
        `INSERT INTO raw.records (source, tenant_id, entity, source_record_id, payload,
           content_sha256, observed_at, lake_key, lake_stamp, run_id)
         VALUES ('itest', $1, 'things', '1', '{"n":1}'::jsonb, repeat('0', 64), now(), 'k', 's', 'r'),
                ('itest', $2, 'things', '1', '{"n":1}'::jsonb, repeat('0', 64), now(), 'k', 's', 'r')
         ON CONFLICT DO NOTHING`,
        [TENANT, OTHER],
      );

      const password = await rotateTenantPassword(exec, TENANT, "dbt", HOUR_MS);
      const tenant = new pg.Pool({
        host: conn.host,
        port: conn.port,
        database: conn.database,
        user: "undercroft_dbt_case_itest",
        password,
        max: 1,
      });
      try {
        const own = asExecutor(tenant);
        const before = await own.query<{ tenant_id: string }>(
          "SELECT DISTINCT tenant_id FROM raw.records WHERE source = 'itest'",
        );
        expect(before.rows.map((r) => r.tenant_id)).toEqual([TENANT]);

        // The escape a customer's SQL could try: RESET ROLE returns to the session user,
        // which IS the tenant role. Nothing more privileged is there to return to.
        await own.exec("RESET ROLE");
        const after = await own.query<{ tenant_id: string }>(
          "SELECT DISTINCT tenant_id FROM raw.records WHERE source = 'itest'",
        );
        expect(after.rows.map((r) => r.tenant_id)).toEqual([TENANT]);

        expect(await refusalOf(() => own.query("SELECT * FROM app.connection_secret"))).toMatch(
          DENIED,
        );
        expect(await refusalOf(() => own.query("SELECT * FROM raw.records_default"))).toMatch(
          DENIED,
        );
        expect(await refusalOf(() => own.query("SET ROLE undercroft_worker"))).toMatch(DENIED);
      } finally {
        await tenant.end();
      }

      // A password rotated an hour ago is no password. The role's VALID UNTIL is in the
      // future for the one just minted, which is what a login needs and all it gets.
      const { rows } = await exec.query<{ rolvaliduntil: string }>(
        "SELECT rolvaliduntil::text FROM pg_roles WHERE rolname = 'undercroft_dbt_case_itest'",
      );
      expect(rows[0]?.rolvaliduntil).toBeDefined();
    } finally {
      await exec.query("DELETE FROM raw.records WHERE source = 'itest'");
      await admin.end();
    }
  });

  // ADR 0087: a build that joins a login late extends it rather than rotating it, because a
  // rotation would refuse every other holder still to authenticate with the password.
  it("extending a login keeps the password it authenticates with", async () => {
    const conn = connection();
    const admin = new pg.Pool({ ...conn.admin, max: 2 });
    const exec = asExecutor(admin);
    try {
      await migrate(exec);
      await exec.query("INSERT INTO ops.tenant (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [
        TENANT,
      ]);
      await provisionTenantRoles(exec, TENANT);
      const password = await rotateTenantPassword(exec, TENANT, "dbt", HOUR_MS);
      await extendTenantPassword(exec, TENANT, "dbt", 3 * HOUR_MS);

      const tenant = new pg.Pool({
        host: conn.host,
        port: conn.port,
        database: conn.database,
        user: "undercroft_dbt_case_itest",
        password,
        max: 1,
      });
      try {
        const { rows } = await tenant.query<{ who: string }>("SELECT current_user AS who");
        expect(rows[0]?.who).toBe("undercroft_dbt_case_itest");
      } finally {
        await tenant.end();
      }
    } finally {
      await admin.end();
    }
  });
});

/** Who a login through the tenant pooler arrives as, or why it was refused. */
async function throughPooler(user: string, password: string): Promise<string> {
  const env = composeEnv();
  const client = new pg.Client({
    host: "127.0.0.1",
    port: Number.parseInt(env.UNDERCROFT_PORT_PGBOUNCER ?? "16432", 10),
    database: env.UNDERCROFT_PG_DB ?? "undercroft",
    user,
    password,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    const { rows } = await client.query<{ who: string }>("SELECT current_user AS who");
    return rows[0]?.who ?? "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await client.end().catch(() => undefined);
  }
}

describe.skipIf(!ENABLED)("a tenant's login through the pooler (ADR 0088)", () => {
  /** The schema, the pooler's own login and the tenant, as a deploy leaves them. */
  async function prepared(): Promise<{
    exec: ReturnType<typeof asExecutor>;
    end: () => Promise<void>;
  }> {
    const env = composeEnv();
    const admin = new pg.Pool({ ...connection().admin, max: 2 });
    const exec = asExecutor(admin);
    await migrate(exec);
    await setRolePassword(exec, "undercroft_worker", env.UNDERCROFT_WORKER_PG_PASSWORD ?? "");
    await setRolePassword(exec, "undercroft_app", env.UNDERCROFT_APP_PG_PASSWORD ?? "");
    await exec.query("INSERT INTO ops.tenant (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [
      TENANT,
    ]);
    await provisionTenantRoles(exec, TENANT);
    return { exec, end: () => admin.end() };
  }

  it("lets the current password in as the tenant's own login, and a rotated-away one no more", async () => {
    const { exec, end } = await prepared();
    try {
      const first = await rotateTenantPassword(exec, TENANT, "dbt", HOUR_MS);
      expect(await throughPooler("undercroft_dbt_case_itest", first)).toBe(
        "undercroft_dbt_case_itest",
      );

      const second = await rotateTenantPassword(exec, TENANT, "dbt", HOUR_MS);
      expect(await throughPooler("undercroft_dbt_case_itest", second)).toBe(
        "undercroft_dbt_case_itest",
      );
      expect(await throughPooler("undercroft_dbt_case_itest", first)).toMatch(REFUSED);
    } finally {
      await end();
    }
  });

  it("refuses an expired password and a platform login", async () => {
    const { exec, end } = await prepared();
    try {
      const password = await rotateTenantPassword(exec, TENANT, "bi", HOUR_MS);
      await exec.exec("ALTER ROLE undercroft_bi_case_itest VALID UNTIL '2000-01-01'");
      expect(await throughPooler("undercroft_bi_case_itest", password)).toMatch(REFUSED);

      const app = composeEnv().UNDERCROFT_APP_PG_PASSWORD ?? "";
      expect(await throughPooler("undercroft_app", app)).toMatch(REFUSED);
    } finally {
      await end();
    }
  });

  // Issue 490, ADR 0146. A build's deadline SIGTERMs dbt, which leaves the statement it sent
  // running in its backend, holding its locks, so the next build's seed TRUNCATE waits on it and
  // dies at its own deadline. Faithful to production: the client is a separate process logged in
  // through the pooler, and it is killed rather than closed politely.
  it("ends a long statement, and frees its lock, once its client process is killed", async () => {
    const { exec, end } = await prepared();
    const login = "undercroft_dbt_case_itest";
    const table = "staging_case_itest.orphan_490";
    const env = composeEnv();
    const child = Bun.spawn([process.execPath, "-e", ORPHANING_CLIENT], {
      cwd: import.meta.dirname,
      env: {
        ORPHAN_HOST: "127.0.0.1",
        ORPHAN_PORT: env.UNDERCROFT_PORT_PGBOUNCER ?? "16432",
        ORPHAN_DB: env.UNDERCROFT_PG_DB ?? "undercroft",
        ORPHAN_USER: login,
        ORPHAN_PASSWORD: await rotateTenantPassword(exec, TENANT, "dbt", HOUR_MS),
        ORPHAN_TABLE: table,
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      await pollUntil(
        exec,
        async () => (await sleepers(exec, login)) > 0,
        async () =>
          `${login} never started its statement; its client ${
            child.exitCode === null ? "is still running" : await new Response(child.stderr).text()
          }`,
      );
      child.kill("SIGTERM");
      await child.exited;

      await pollUntil(
        exec,
        async () => (await sleepers(exec, login)) === 0,
        () =>
          Promise.resolve(
            `${login}'s statement outlived its killed client by 20 s: client_connection_check_interval is not in force`,
          ),
      );
      const admin = new pg.Client(connection().admin);
      await admin.connect();
      try {
        await admin.query("BEGIN");
        // NOWAIT: a lock the orphan still held raises here rather than waiting for it.
        await admin.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE NOWAIT`);
        await admin.query("ROLLBACK");
      } finally {
        await admin.end();
      }
    } finally {
      child.kill("SIGKILL");
      await exec.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1",
        [login],
      );
      await exec.exec(`DROP TABLE IF EXISTS ${table}`);
      await end();
    }
    // Longer than Bun's ten seconds: the setting is checked every five, and the wait for it is
    // bounded at twenty so a miss fails with its own message rather than a bare timeout.
  }, 60_000);
});

/**
 * The client of the test above, run as its own process with the tenant's dbt login: it makes a
 * table, takes an exclusive lock on it and then sits in a ten-minute statement, as a model's
 * `CREATE TABLE AS` does. Written out here, not in a fixture file, so the test reads whole.
 */
const ORPHANING_CLIENT = `
const { default: pg } = await import("pg");
const e = process.env;
const client = new pg.Client({
  host: e.ORPHAN_HOST,
  port: Number.parseInt(e.ORPHAN_PORT, 10),
  database: e.ORPHAN_DB,
  user: e.ORPHAN_USER,
  password: e.ORPHAN_PASSWORD,
});
await client.connect();
await client.query(\`CREATE TABLE IF NOT EXISTS \${e.ORPHAN_TABLE} (id int)\`);
await client.query("BEGIN");
await client.query(\`LOCK TABLE \${e.ORPHAN_TABLE} IN ACCESS EXCLUSIVE MODE\`);
await client.query("SELECT pg_sleep(600)");
`;

/** How many of `user`'s backends are in the ten-minute sleep of `ORPHANING_CLIENT`. */
async function sleepers(exec: ReturnType<typeof asExecutor>, user: string): Promise<number> {
  const { rows } = await exec.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
     WHERE usename = $1 AND state = 'active' AND query LIKE '%pg_sleep(600)%'`,
    [user],
  );
  return rows[0]?.n ?? 0;
}

/** Ask `ready` every 50 ms for at most twenty seconds; fail with what `failure` says. */
async function pollUntil(
  exec: ReturnType<typeof asExecutor>,
  ready: () => Promise<boolean>,
  failure: () => Promise<string>,
): Promise<void> {
  for (let tries = 0; tries < 400; tries += 1) {
    if (await ready()) {
      return;
    }
    await exec.query("SELECT pg_sleep(0.05)");
  }
  throw new Error(await failure());
}

/** Wait until a backend of `user` is waiting on a lock: at most ten seconds, asked every 50 ms. */
async function blockedOnLock(exec: ReturnType<typeof asExecutor>, user: string): Promise<void> {
  for (let tries = 0; tries < 200; tries += 1) {
    const { rows } = await exec.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE usename = $1 AND wait_event_type = 'Lock'`,
      [user],
    );
    if ((rows[0]?.n ?? 0) > 0) {
      return;
    }
    await exec.query("SELECT pg_sleep(0.05)");
  }
  throw new Error(`${user} never waited on the promotion's lock`);
}

/** A connection straight to Postgres as `user`, not through the pooler. */
function direct(user: string, password: string): pg.Client {
  const conn = connection();
  return new pg.Client({
    host: conn.host,
    port: conn.port,
    database: conn.database,
    user,
    password,
  });
}

describe.skipIf(!ENABLED)("a scope login, against real Postgres (ADR 0142)", () => {
  /** The schema, the pooler's login, the tenant and its tables, as a deploy and a build leave them. */
  async function prepared(): Promise<{
    exec: ReturnType<typeof asExecutor>;
    end: () => Promise<void>;
  }> {
    const env = composeEnv();
    const admin = new pg.Pool({ ...connection().admin, max: 2 });
    const exec = asExecutor(admin);
    await migrate(exec);
    await setRolePassword(exec, "undercroft_worker", env.UNDERCROFT_WORKER_PG_PASSWORD ?? "");
    await exec.query("INSERT INTO ops.tenant (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [
      TENANT,
    ]);
    await provisionTenantRoles(exec, TENANT);
    // What a build would have left: tables owned by the tenant's dbt login, and a view.
    await exec.exec(`
      BEGIN;
      SET LOCAL ROLE undercroft_dbt_case_itest;
      DROP VIEW IF EXISTS analytics_case_itest.itest_view;
      DROP TABLE IF EXISTS analytics_case_itest.itest_granted, analytics_case_itest.itest_other,
        analytics_case_itest.itest_pub, staging_case_itest.itest_pub, dq_case_itest.itest_failures;
      CREATE TABLE analytics_case_itest.itest_granted AS SELECT 1 AS n;
      CREATE TABLE analytics_case_itest.itest_other AS SELECT 2 AS n;
      CREATE TABLE analytics_case_itest.itest_pub AS SELECT 1 AS n;
      CREATE VIEW analytics_case_itest.itest_view AS SELECT n FROM analytics_case_itest.itest_other;
      CREATE TABLE dq_case_itest.itest_failures AS SELECT 3 AS n;
      COMMIT;`);
    return { exec, end: () => admin.end() };
  }

  it("reads its tables, and neither RESET ROLE nor set_config nor a view reaches more", async () => {
    const { exec, end } = await prepared();
    try {
      const login = await provisionScope(exec, TENANT, ["itest_granted", "itest_view"]);
      const password = await rotateTenantPassword(exec, TENANT, { kind: "scope", login }, HOUR_MS);
      const scoped = direct(login, password);
      await scoped.connect();
      try {
        const own = await scoped.query<{ n: number }>(
          "SELECT n FROM analytics_case_itest.itest_granted",
        );
        expect(own.rows).toEqual([{ n: 1 }]);

        await scoped.query("RESET ROLE");
        await scoped.query("SELECT set_config('search_path', 'analytics_case_itest, raw', false)");
        for (const sql of [
          "SELECT * FROM itest_other",
          "SELECT * FROM analytics_case_itest.itest_view",
          "SELECT * FROM dq_case_itest.itest_failures",
          "SELECT * FROM staging_case_itest.itest_pub",
          "SELECT * FROM raw.records",
          "SELECT * FROM ops.tenant_scope",
        ]) {
          expect(await refusalOf(() => scoped.query(sql))).toMatch(DENIED);
        }
        expect(await refusalOf(() => scoped.query("SET ROLE undercroft_bi_case_itest"))).toMatch(
          DENIED,
        );
      } finally {
        await scoped.end();
      }
    } finally {
      await end();
    }
  });

  it("is never refused, nor over-served, while a promotion republishes its table", async () => {
    const { exec, end } = await prepared();
    try {
      const reader = await provisionScope(exec, TENANT, ["itest_pub"]);
      const outsider = await provisionScope(exec, TENANT, ["itest_granted"]);
      const builder = direct(
        "undercroft_dbt_case_itest",
        await rotateTenantPassword(exec, TENANT, "dbt", HOUR_MS),
      );
      const scoped = direct(
        reader,
        await rotateTenantPassword(exec, TENANT, { kind: "scope", login: reader }, HOUR_MS),
      );
      const outside = direct(
        outsider,
        await rotateTenantPassword(exec, TENANT, { kind: "scope", login: outsider }, HOUR_MS),
      );
      await Promise.all([builder.connect(), scoped.connect(), outside.connect()]);
      try {
        // The promotion as `promote.ts` runs it: grant the staged table, drop the published one,
        // move the staged one in -- one transaction, committed only once the reader is waiting.
        await builder.query("BEGIN");
        await builder.query("CREATE TABLE staging_case_itest.itest_pub AS SELECT 2 AS n");
        await builder.query("SELECT raw.grant_staged_to_scopes(current_user, $1::text[])", [
          ["itest_pub"],
        ]);
        await builder.query("DROP TABLE analytics_case_itest.itest_pub RESTRICT");
        await builder.query(
          "ALTER TABLE staging_case_itest.itest_pub SET SCHEMA analytics_case_itest",
        );
        const waiting = scoped.query<{ n: number }>("SELECT n FROM analytics_case_itest.itest_pub");
        // Committed only once the reader is blocked on the promotion's lock, so what it reads is
        // decided at the instant the promotion becomes visible, not before or after it.
        await blockedOnLock(exec, reader);
        await builder.query("COMMIT");

        expect((await waiting).rows).toEqual([{ n: 2 }]);
        expect(
          await refusalOf(() => outside.query("SELECT n FROM analytics_case_itest.itest_pub")),
        ).toMatch(DENIED);
      } finally {
        await Promise.all([builder.end(), scoped.end(), outside.end()]);
      }
    } finally {
      await end();
    }
  });

  it("is admitted by the pooler while its password lives, and by nothing once it is swept", async () => {
    const { exec, end } = await prepared();
    try {
      const login = await provisionScope(exec, TENANT, ["itest_granted"]);
      const password = await rotateTenantPassword(exec, TENANT, { kind: "scope", login }, HOUR_MS);
      expect(await throughPooler(login, password)).toBe(login);

      // Nobody has used it for a week, its lease is over, and the pooler has closed its idle
      // server connection (fifteen seconds in production; at once here).
      await exec.query(
        `UPDATE ops.tenant_scope SET last_used_at = now() - interval '8 days' WHERE role_name = $1`,
        [login],
      );
      await exec.exec(`ALTER ROLE "${login}" VALID UNTIL '2000-01-01'`);
      await exec.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1",
        [login],
      );
      const { rows } = await exec.query<{ dropped: number }>(
        "SELECT ops.drop_stale_scopes($1) AS dropped",
        [TENANT],
      );

      expect(rows[0]?.dropped).toBeGreaterThanOrEqual(1);
      expect(await throughPooler(login, password)).toMatch(REFUSED);
      expect(await refusalOf(() => direct(login, password).connect())).toMatch(
        /password authentication failed|does not exist/iu,
      );
    } finally {
      await end();
    }
  });
});

describe.skipIf(!ENABLED)(
  "a scope login's row and column rules, against real Postgres (ADR 0143)",
  () => {
    const PEOPLE = "analytics_case_itest.itest_people";
    const SALES = {
      model: "itest_people",
      rows: [[{ column: "dept", op: "eq", values: ["Sales"] }]],
      hidden: ["salary"],
    };
    const SUPPORT = {
      model: "itest_people",
      rows: [[{ column: "dept", op: "eq", values: ["Support"] }]],
      hidden: [],
    };
    const BROKEN = {
      model: "itest_people",
      rows: [[{ column: "region", op: "eq", values: ["north"] }]],
      hidden: [],
    };

    /** The tenant as a deploy and a build leave it, with a table some readers see only part of. */
    async function prepared(): Promise<{
      exec: ReturnType<typeof asExecutor>;
      end: () => Promise<void>;
    }> {
      const env = composeEnv();
      const admin = new pg.Pool({ ...connection().admin, max: 2 });
      const exec = asExecutor(admin);
      await migrate(exec);
      await setRolePassword(exec, "undercroft_worker", env.UNDERCROFT_WORKER_PG_PASSWORD ?? "");
      await exec.query("INSERT INTO ops.tenant (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [
        TENANT,
      ]);
      await provisionTenantRoles(exec, TENANT);
      await exec.exec(`
      BEGIN;
      SET LOCAL ROLE undercroft_dbt_case_itest;
      DROP TABLE IF EXISTS ${PEOPLE}, staging_case_itest.itest_people;
      CREATE TABLE ${PEOPLE} AS
        SELECT * FROM (VALUES ('Sales', 1, 1000), ('Support', 2, 2000), (NULL, 3, 3000))
          AS v(dept, region_id, salary);
      COMMIT;`);
      return { exec, end: () => admin.end() };
    }

    /** A direct connection as the scope login for `limits`, its password leased. */
    async function scopedAs(
      exec: ReturnType<typeof asExecutor>,
      limits: Parameters<typeof provisionScope>[3],
    ): Promise<{ login: string; client: pg.Client }> {
      const login = await provisionScope(exec, TENANT, ["itest_people"], limits);
      const password = await rotateTenantPassword(exec, TENANT, { kind: "scope", login }, HOUR_MS);
      const client = direct(login, password);
      await client.connect();
      return { login, client };
    }

    async function depts(client: pg.Client): Promise<(string | null)[]> {
      const { rows } = await client.query<{ dept: string | null }>(
        `SELECT dept FROM ${PEOPLE} ORDER BY region_id`,
      );
      return rows.map((row) => row.dept);
    }

    it("shows a ruled login its rows only, refuses its hidden column, and RESET ROLE nor set_config widen it", async () => {
      const { exec, end } = await prepared();
      try {
        const { client } = await scopedAs(exec, [SALES]);
        const bi = direct(
          "undercroft_bi_case_itest",
          await rotateTenantPassword(exec, TENANT, "bi", HOUR_MS),
        );
        await bi.connect();
        try {
          expect(await depts(client)).toEqual(["Sales"]);

          await client.query("RESET ROLE");
          await client.query("SELECT set_config('undercroft.scope', 'all', false)");
          expect(await depts(client)).toEqual(["Sales"]);
          // Turning row security off does not lift a policy for a login it applies to: Postgres
          // refuses the query instead of answering it whole.
          await client.query("SET row_security = off");
          expect(await refusalOf(() => depts(client))).toMatch(/row-level security/iu);
          await client.query("RESET row_security");
          expect(await refusalOf(() => client.query(`SELECT salary FROM ${PEOPLE}`))).toMatch(
            DENIED,
          );
          expect(await refusalOf(() => client.query(`SELECT * FROM ${PEOPLE}`))).toMatch(DENIED);
          const columns = await client.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'analytics_case_itest' AND table_name = 'itest_people' ORDER BY 1`,
          );
          expect(columns.rows.map((row) => row.column_name)).toEqual(["dept", "region_id"]);

          // The customer's own BI login reads every row and every column, as before.
          expect(await depts(bi)).toEqual(["Sales", "Support", null]);
          const salaries = await bi.query<{ n: string }>(
            `SELECT sum(salary)::text AS n FROM ${PEOPLE}`,
          );
          expect(salaries.rows).toEqual([{ n: "6000" }]);
        } finally {
          await Promise.all([client.end(), bi.end()]);
        }
      } finally {
        await end();
      }
    });

    it("gives two scopes their own rows of one table, and a rule naming a dropped column no row", async () => {
      const { exec, end } = await prepared();
      try {
        const sales = await scopedAs(exec, [SALES]);
        const support = await scopedAs(exec, [SUPPORT]);
        const broken = await scopedAs(exec, [BROKEN]);
        try {
          expect(sales.login).not.toBe(support.login);
          expect(await depts(sales.client)).toEqual(["Sales"]);
          expect(await depts(support.client)).toEqual(["Support"]);
          expect(await depts(broken.client)).toEqual([]);
        } finally {
          await Promise.all([sales.client.end(), support.client.end(), broken.client.end()]);
        }
      } finally {
        await end();
      }
    });

    it("is admitted by the pooler and reads only its rows there too", async () => {
      const { exec, end } = await prepared();
      try {
        const login = await provisionScope(exec, TENANT, ["itest_people"], [SUPPORT]);
        const password = await rotateTenantPassword(
          exec,
          TENANT,
          { kind: "scope", login },
          HOUR_MS,
        );
        const env = composeEnv();
        const pooled = new pg.Client({
          host: "127.0.0.1",
          port: Number.parseInt(env.UNDERCROFT_PORT_PGBOUNCER ?? "16432", 10),
          database: env.UNDERCROFT_PG_DB ?? "undercroft",
          user: login,
          password,
          connectionTimeoutMillis: 10_000,
        });
        await pooled.connect();
        try {
          expect(await depts(pooled)).toEqual(["Support"]);
        } finally {
          await pooled.end();
        }
      } finally {
        await end();
      }
    });

    it("keeps a republished table's rows and columns limited, with no instant it is not", async () => {
      const { exec, end } = await prepared();
      try {
        const reader = await scopedAs(exec, [SALES]);
        const builder = direct(
          "undercroft_dbt_case_itest",
          await rotateTenantPassword(exec, TENANT, "dbt", HOUR_MS),
        );
        await builder.connect();
        try {
          // The promotion as `promote.ts` runs it, committed only once the reader is waiting on it.
          await builder.query("BEGIN");
          await builder.query(`CREATE TABLE staging_case_itest.itest_people AS
          SELECT * FROM (VALUES ('Sales', 1, 9), ('Support', 2, 9), ('Sales', 3, 9))
            AS v(dept, region_id, salary)`);
          await builder.query("SELECT raw.grant_staged_to_scopes(current_user, $1::text[])", [
            ["itest_people"],
          ]);
          await builder.query(`DROP TABLE ${PEOPLE} RESTRICT`);
          await builder.query(
            "ALTER TABLE staging_case_itest.itest_people SET SCHEMA analytics_case_itest",
          );
          const waiting = depts(reader.client);
          await blockedOnLock(exec, reader.login);
          await builder.query("COMMIT");

          expect(await waiting).toEqual(["Sales", "Sales"]);
          expect(
            await refusalOf(() => reader.client.query(`SELECT salary FROM ${PEOPLE}`)),
          ).toMatch(DENIED);
        } finally {
          await Promise.all([builder.end(), reader.client.end()]);
        }
      } finally {
        await end();
      }
    });
  },
);
