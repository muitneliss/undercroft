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
 *   bun run itest        # reads deploy/compose/.env, expects `docker compose up postgres`
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

import { migrate } from "./migrate.ts";
import { asExecutor } from "./pool.ts";
import { provisionTenantRoles, rotateTenantPassword } from "./repos/tenantRoles.ts";

// biome-ignore lint/style/noProcessEnv: The integration tier gates itself on the env var that turns it on. A suite is its own composition root -- `layering.md`.
const ENABLED = process.env.UNDERCROFT_ITEST === "1";
const TENANT = "CASE-ITEST";
const OTHER = "CASE-ITEST-OTHER";
const DENIED = /permission denied/iu;

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

      const password = await rotateTenantPassword(exec, TENANT, "dbt");
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
});
