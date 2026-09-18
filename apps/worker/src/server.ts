/**
 * The worker's process entrypoint.
 *
 * Wires the real S3 store, the real Postgres pool and the connector specs into the lake
 * API, and listens on :8081 -- the port Kestra and the control plane call. Idle until
 * called; it starts no work on its own, so a restart never re-runs a sync.
 */

// biome-ignore-all lint/correctness/noNodejsModules: This is server code running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.
// biome-ignore-all lint/style/noProcessEnv: The composition root reads configuration from the environment on purpose; `.claude/rules/layering.md` puts it here precisely so that no layer below does. That direction is enforced separately by the `layer-injected-deps` ast-grep rule, which is the check that actually binds.

import { join } from "node:path";
import process from "node:process";
import { asExecutor, createPool } from "@undercroft/db";
import { LakeStore, S3ObjectStore } from "@undercroft/lake";
import { createLakeApi } from "./handlers/lake.ts";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

const pool = createPool(required("UNDERCROFT_POSTGRES_DSN"));
const store = new S3ObjectStore({
  bucket: required("UNDERCROFT_S3_BUCKET_RAW"),
  ...(process.env.UNDERCROFT_S3_ENDPOINT === undefined
    ? {}
    : { endpoint: process.env.UNDERCROFT_S3_ENDPOINT }),
  ...(process.env.UNDERCROFT_S3_ACCESS_KEY !== undefined &&
  process.env.UNDERCROFT_S3_SECRET_KEY !== undefined
    ? {
        accessKeyId: process.env.UNDERCROFT_S3_ACCESS_KEY,
        secretAccessKey: process.env.UNDERCROFT_S3_SECRET_KEY,
      }
    : {}),
});

const app = createLakeApi({
  lake: new LakeStore(store),
  exec: asExecutor(pool),
  serviceToken: required("UNDERCROFT_TRIGGER_TOKEN"),
  specsDir:
    process.env.UNDERCROFT_SPECS_DIR ??
    join(import.meta.dirname, "..", "..", "..", "specs", "connectors"),
  dbt: {
    projectDir:
      process.env.UNDERCROFT_DBT_PROJECT_DIR ??
      join(import.meta.dirname, "..", "..", "..", "dbt", "undercroft_starter"),
    profilesDir:
      process.env.UNDERCROFT_DBT_PROFILES_DIR ?? join(import.meta.dirname, "..", "..", "..", "dbt"),
  },
});

// parseInt, not Number(): a port, not an amount (the money lint rule bans Number()).
const port = Number.parseInt(process.env.UNDERCROFT_WORKER_PORT ?? "8081", 10);
// biome-ignore lint/suspicious/noConsole: The startup line an operator greps for to learn
// which port the worker actually bound -- stdout is where a container puts it, and this is
// the composition root, which is the one place a process may speak for itself.
console.log(`undercroft worker listening on :${port}`);

export default { port, fetch: app.fetch };
