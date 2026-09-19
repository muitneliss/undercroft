/**
 * The worker's process entrypoint.
 *
 * Wires the real S3 store, the real Postgres pool and the connector specs into the lake
 * API, and listens on :8081 -- the port Kestra and the control plane call. Idle until
 * called; it starts no work on its own, so a restart never re-runs a sync.
 */

import { join } from "node:path";
import process from "node:process";
import { createByteFetcher, createLogger } from "@undercroft/core";
import { asExecutor, connectionOf, createPool, withTransaction } from "@undercroft/db";
import { LakeStore, S3ObjectStore } from "@undercroft/lake";
import { createLakeApi } from "./handlers/lake.ts";
import type { XeroClient } from "./services/connections.ts";
import { googleRefresher } from "./services/google/refresh.ts";
import type { Refresher } from "./services/runTypes.ts";
import { closeAbandonedRuns } from "./services/ledger.ts";
import { createTenantSessions } from "./services/tenantSession.ts";
import { xeroRefresher } from "./services/xero/refresh.ts";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

/**
 * The Xero client, when this deployment has one. The worker refreshes with it (Xero rotates,
 * and the rotated pair is written back under the row lock) and revokes with it.
 */
function xeroClient(): XeroClient | undefined {
  const clientId = process.env.UNDERCROFT_XERO_CLIENT_ID ?? "";
  const clientSecret = process.env.UNDERCROFT_XERO_CLIENT_SECRET ?? "";
  return clientId === "" || clientSecret === "" ? undefined : { clientId, clientSecret };
}

/**
 * One refresher per source that can refresh.
 *
 * The Google sources share one OAuth client, so they share one refresher. With no client
 * configured a source is simply absent from the map rather than a broken entry: a run then
 * finds no credential and says so, rather than failing later with something that reads like
 * a provider outage. HubSpot is deliberately absent: a private-app token has nothing to
 * refresh with.
 */
function refreshers(xeroClientOrNone: XeroClient | undefined): Record<string, Refresher> {
  const found: Record<string, Refresher> = {};
  const clientId = process.env.UNDERCROFT_GOOGLE_INGEST_CLIENT_ID ?? "";
  const clientSecret = process.env.UNDERCROFT_GOOGLE_INGEST_CLIENT_SECRET ?? "";
  if (clientId !== "" && clientSecret !== "") {
    const refresh = googleRefresher({ clientId, clientSecret, fetcher: createByteFetcher() });
    found.gmail = refresh;
    found.drive = refresh;
  }
  if (xeroClientOrNone !== undefined) {
    found.xero = xeroRefresher({ ...xeroClientOrNone, fetcher: createByteFetcher() });
  }
  return found;
}

// JSONL on stdout, the same shape the control plane writes; the container runtime collects
// it. Before this the worker's whole output was the startup line, so a run that failed at
// 02:00 left no evidence anywhere.
const log = createLogger({ component: "worker" });

const dsn = required("UNDERCROFT_POSTGRES_DSN");
const pool = createPool(dsn);
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

const xero = xeroClient();

const app = createLakeApi({
  lake: new LakeStore(store),
  exec: asExecutor(pool),
  serviceToken: required("UNDERCROFT_TRIGGER_TOKEN"),
  log,
  refreshers: refreshers(xero),
  ...(xero === undefined ? {} : { xero }),
  // Without this the `SELECT ... FOR UPDATE` in `accessToken` holds a lock for one
  // statement and protects nothing, which is what lets two concurrent runs spend the same
  // refresh token. See `services/ingest.ts`.
  transactor: (fn) => withTransaction(pool, fn),
  specsDir:
    process.env.UNDERCROFT_SPECS_DIR ??
    join(import.meta.dirname, "..", "..", "..", "specs", "connectors"),
  // A tenant's project is generated per build from `app.model` and pointed at the same
  // server this process is on; the worker becomes the tenant to build and to read. The
  // child's environment is this process's, so `PATH` finds the `dbt` the image installed.
  dbt: {
    database: connectionOf(dsn),
    sessions: createTenantSessions({ exec: asExecutor(pool), dsn }),
    env: process.env,
  },
});

// Whatever the previous process was in the middle of is over; the ledger says so before the
// first request can collide with a row that would otherwise stay `running` forever.
await closeAbandonedRuns(asExecutor(pool), log);

// parseInt, not Number(): a port, not an amount (the money lint rule bans Number()).
const port = Number.parseInt(process.env.UNDERCROFT_WORKER_PORT ?? "8081", 10);
// The startup line an operator greps to learn which port the worker actually bound.
log.info("listening", { port });

export default { port, fetch: app.fetch };
