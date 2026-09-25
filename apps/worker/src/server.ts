/**
 * The worker's process entrypoint.
 *
 * Wires the real S3 store, the real Postgres pool and the connector specs into the lake
 * API, and listens on :8081 -- the port Kestra and the control plane call. Idle until
 * called; it starts no work on its own, so a restart never re-runs a sync.
 *
 * It is also the only module that knows it is a process, so it owns the stop: on SIGTERM or
 * SIGINT it tells every run in flight to stop at its next safe boundary and waits, for a
 * bounded time, for them to settle with what they landed. Before this there was no handler at
 * all, so a deploy's SIGTERM killed the worker on the spot and every run it was in the middle
 * of was closed at the next boot with no counts. ADR 0051.
 */

import { join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { createByteFetcher, createLogger } from "@undercroft/core";
import { asExecutor, connectionOf, createPool, withTransaction } from "@undercroft/db";
import { LakeStore, S3ObjectStore } from "@undercroft/lake";
import { startTelemetry } from "@undercroft/telemetry";
import { createLakeApi } from "./handlers/lake.ts";
import type { XeroClient } from "./services/connections.ts";
import { googleRefresher } from "./services/google/refresh.ts";
import { drainJobs } from "./services/jobs.ts";
import type { Refresher } from "./services/runTypes.ts";
import { closeAbandonedRuns } from "./services/ledger.ts";
import { createTenantSessions } from "./services/tenantSession.ts";
import { realSpawn } from "./services/transform.ts";
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
// Before anything logs. An unset OTEL_EXPORTER_OTLP_ENDPOINT is export off; the trace ids are
// stamped either way (ADR 0058).
const telemetry = startTelemetry({ service: "undercroft-worker", env: process.env });
const log = createLogger({ component: "worker", ...telemetry.logging });
log.info(telemetry.exporting ? "telemetry_exporting" : "telemetry_export_off");

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

/**
 * How long a stop waits for the runs in flight to settle before the process exits anyway.
 *
 * ONE DECISION WITH `stop_grace_period: 60s` on the worker in
 * `deploy/compose/docker-compose.server.yml`, which is how long Docker waits after SIGTERM
 * before it sends SIGKILL. This must be the smaller number, with room for the exit itself: a
 * wait that outlived the grace period would be cut off by the SIGKILL it exists to avoid, and
 * the run would be closed at boot with no counts -- exactly the outcome of having no handler.
 * An ingest usually stops in seconds (between two records, or between two messages); what does
 * not settle in time -- a chunk of attachments mid-fetch, a Gmail listing, a dbt build -- is
 * left to `closeAbandonedRuns` at the next boot, as everything was before. If one number
 * moves, both do.
 */
const DRAIN_MS = 45_000;

/** Aborted once, on the first stop signal; every run this process starts is handed it. */
const stopping = new AbortController();

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
  // The child environment every spawned reader inherits. `PATH` is the load-bearing part:
  // without it `Bun.spawn` cannot find `pdftotext` even where the image installed it, and
  // every PDF reports the binary as missing. Read here and nowhere below (`layering.md`).
  env: process.env,
  // Which build every run this process opens was produced by. Baked into the image by
  // `deploy/Dockerfile.worker` from a build arg CI fills, because the deploy pointer is
  // `latest` on purpose and therefore names no version. `""` when the image did not say --
  // a blank the journal renders as "this build did not say", never a guessed version.
  releaseTag: process.env.UNDERCROFT_RELEASE ?? "",
  // The extract verb reads landed documents with poppler and tesseract, which the image
  // installs alongside dbt. Present unconditionally: the binaries are part of the image, and
  // one that is missing is reported per document as `extractor-missing:<program>` rather than
  // by the verb quietly not existing. ADR 0024.
  extractSpawn: realSpawn,
  stop: stopping.signal,
});

// Whatever the previous process was in the middle of is over; the ledger says so before the
// first request can collide with a row that would otherwise stay `running` forever.
await closeAbandonedRuns(asExecutor(pool), log);

/**
 * Stop: tell the runs, wait for them within the bound, then exit.
 *
 * A second signal while waiting exits at once -- a person at a terminal pressing Ctrl-C twice
 * has decided not to wait, and what is still running is closed at the next boot as before.
 */
async function stop(signal: string): Promise<void> {
  if (stopping.signal.aborted) {
    log.warn("stop_forced", { signal });
    process.exit(1);
  }
  log.info("stopping", { signal, drainMs: DRAIN_MS });
  stopping.abort();
  const drained = await Promise.race([
    drainJobs().then(() => true),
    delay(DRAIN_MS).then(() => false),
  ]);
  // `drained: false` is the line to grep after a deploy: the runs it left behind are closed at
  // the next boot rather than settled, and their counts are not on them.
  log.info("stopped", { signal, drained });
  await telemetry.shutdown();
  process.exit(0);
}
process.on("SIGTERM", (signal) => void stop(signal));
process.on("SIGINT", (signal) => void stop(signal));

// parseInt, not Number(): a port, not an amount (the money lint rule bans Number()).
const port = Number.parseInt(process.env.UNDERCROFT_WORKER_PORT ?? "8081", 10);
// The startup line an operator greps to learn which port the worker actually bound.
log.info("listening", { port });

export default { port, fetch: app.fetch };
