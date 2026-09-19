/**
 * Apply the migrations to a real database.
 *
 *   bun run migrate
 *
 * This exists because `migrate()` had no caller outside the test suite: every test built a
 * PGlite database and applied the SQL, so the schema was proven correct and yet there was
 * no supported way to put it into a deployed Postgres. A migration nobody can apply is a
 * migration that does not exist, and the first thing to actually need one was sign-in --
 * a login fails with "relation app.auth_user does not exist" if this never runs.
 *
 * Deliberately a separate command rather than a call at service boot. The control plane can
 * run more than one replica, and two replicas racing the same DDL on startup is a failure
 * that only appears under the load you least want it to. A deploy applies this once, as its
 * own step, and then starts the services.
 *
 * It reports what it applied and what it skipped, because "already up to date" and "applied
 * four files" are different facts and a deploy log that cannot tell them apart is no
 * evidence at all.
 */

import process from "node:process";
import { migrate, type PlatformLoginRole, setRolePassword } from "./migrate.ts";
import { asExecutor, createPool } from "./pool.ts";

/**
 * Which environment variable carries each platform role's password.
 *
 * Read here, in the composition root, and only here. A variable that is unset or empty
 * leaves that role's password alone, which is what a developer running `bun run migrate`
 * against a scratch database wants; the compose files mark both as required, so a deploy
 * cannot forget one silently.
 */
const ROLE_PASSWORDS: ReadonlyArray<readonly [PlatformLoginRole, string]> = [
  ["undercroft_app", "UNDERCROFT_APP_PG_PASSWORD"],
  ["undercroft_worker", "UNDERCROFT_WORKER_PG_PASSWORD"],
];

async function main(): Promise<void> {
  const dsn = process.env.UNDERCROFT_POSTGRES_DSN;
  if (dsn === undefined || dsn === "") {
    throw new Error("UNDERCROFT_POSTGRES_DSN is required");
  }

  const pool = createPool(dsn);
  try {
    const exec = asExecutor(pool);
    const result = await migrate(exec);
    for (const name of result.skipped) {
      process.stdout.write(`skip   ${name}\n`);
    }
    for (const name of result.applied) {
      process.stdout.write(`apply  ${name}\n`);
    }
    process.stdout.write(
      result.applied.length === 0
        ? "already up to date\n"
        : `applied ${String(result.applied.length)} migration(s)\n`,
    );

    // The role's name is reported; its password never is.
    for (const [role, variable] of ROLE_PASSWORDS) {
      const password = process.env[variable];
      if (password === undefined || password === "") {
        process.stdout.write(`skip   password for ${role} (${variable} unset)\n`);
      } else {
        await setRolePassword(exec, role, password);
        process.stdout.write(`set    password for ${role}\n`);
      }
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
