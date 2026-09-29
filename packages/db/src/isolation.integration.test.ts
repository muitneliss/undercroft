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
});
