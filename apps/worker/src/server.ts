/**
 * The worker's process entrypoint.
 *
 * Wires the real S3 store, the real Postgres pool and the connector specs into the lake
 * API, and listens on :8081 -- the port Kestra and the control plane call. Idle until
 * called; it starts no work on its own, so a restart never re-runs a sync.
 */

import { createByteFetcher } from "@undercroft/core";
import { asExecutor, createPool, withTransaction } from "@undercroft/db";
import { LakeStore, S3ObjectStore } from "@undercroft/lake";
import { join } from "node:path";
import { createLakeApi } from "./handlers/lake.ts";
import { googleRefresher } from "./services/google/refresh.ts";
import type { Refresher } from "./services/ingest.ts";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

/**
 * The Google sources share one OAuth client, so they share one refresher.
 *
 * With no client configured this is an empty map rather than a broken entry: `gmail` and
 * `drive` then behave the way an unconfigured source should -- a run finds no credential
 * and says so -- rather than failing later with something that reads like a Google outage.
 *
 * HubSpot and Xero are deliberately absent. Neither has ever had a refresher, and Xero's
 * rotation semantics (the old token dies the instant the new one is issued) deserve their
 * own change rather than a line in this one.
 */
function googleRefreshers(): Record<string, Refresher> {
  const clientId = process.env.UNDERCROFT_GOOGLE_INGEST_CLIENT_ID ?? "";
  const clientSecret = process.env.UNDERCROFT_GOOGLE_INGEST_CLIENT_SECRET ?? "";
  if (clientId === "" || clientSecret === "") {
    return {};
  }
  const refresh = googleRefresher({ clientId, clientSecret, fetcher: createByteFetcher() });
  return { gmail: refresh, drive: refresh };
}

const pool = createPool(required("UNDERCROFT_POSTGRES_DSN"));
const store = new S3ObjectStore({
  bucket: required("UNDERCROFT_S3_BUCKET_RAW"),
  ...(process.env.UNDERCROFT_S3_ENDPOINT !== undefined
    ? { endpoint: process.env.UNDERCROFT_S3_ENDPOINT }
    : {}),
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
  refreshers: googleRefreshers(),
  // Without this the `SELECT ... FOR UPDATE` in `accessToken` holds a lock for one
  // statement and protects nothing, which is what lets two concurrent runs spend the same
  // refresh token. See `services/ingest.ts`.
  transactor: (fn) => withTransaction(pool, fn),
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
const port = parseInt(process.env.UNDERCROFT_WORKER_PORT ?? "8081", 10);
console.log(`undercroft worker listening on :${port}`);

export default { port, fetch: app.fetch };
