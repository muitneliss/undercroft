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

import { migrate } from "./migrate.ts";
import { asExecutor, createPool } from "./pool.ts";

async function main(): Promise<void> {
  const dsn = process.env["UNDERCROFT_POSTGRES_DSN"];
  if (dsn === undefined || dsn === "") {
    throw new Error("UNDERCROFT_POSTGRES_DSN is required");
  }

  const pool = createPool(dsn);
  try {
    const result = await migrate(asExecutor(pool));
    for (const name of result.skipped) process.stdout.write(`skip   ${name}\n`);
    for (const name of result.applied) process.stdout.write(`apply  ${name}\n`);
    process.stdout.write(
      result.applied.length === 0
        ? "already up to date\n"
        : `applied ${String(result.applied.length)} migration(s)\n`,
    );
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
