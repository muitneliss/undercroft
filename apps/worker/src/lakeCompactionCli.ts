/**
 * Compact the raw lake -- a dry run unless told `--apply`. ADR 0160.
 *
 *   task db:lake-compact                                   plan every tenant, delete nothing
 *   task db:lake-compact -- --tenant CASE-0042             one tenant
 *   task db:lake-compact -- --tenant CASE-0042 --apply     and remove what the plan names
 *
 * A composition root, like `extractionAccuracyCli.ts` beside it, and for its reason: it needs a
 * DSN and the object store, and `scripts/` cannot import the worker. It reads
 * `UNDERCROFT_POSTGRES_DSN` (the worker's own role: it reads `raw.load_cursor` and `ops.run`),
 * `UNDERCROFT_S3_BUCKET_RAW` and its endpoint and keys, exactly as the worker does.
 * `docs/runbook/deployment.md`, "Compacting the lake", says how they reach production.
 *
 * WHY A DRY RUN IS THE DEFAULT. This deletes from the only layer that cannot be recomputed. The
 * command a person types without thinking must be the one that changes nothing; the one that
 * deletes must be spelled out. Either way each stream's plan is written to the lake under
 * `_reports/lake-compaction/` before anything else happens, so a dry run's list and a real run's
 * can be compared, and what a real run removed is on record whether or not it finished.
 *
 * What it prints is one JSON line per stream -- counts, cursor and the report keys. The
 * (key, stamp) list is in the reports, not on a terminal: a stream can name 190,000 of them.
 */

import process from "node:process";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { createLogger } from "@undercroft/core";
import { asExecutor, createPool } from "@undercroft/db";
import { LakeStore, S3ObjectStore } from "@undercroft/lake";

import { compactLake, DEFAULT_CONCURRENCY } from "./services/lakeCompaction.ts";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function openLake(): LakeStore {
  const endpoint = process.env.UNDERCROFT_S3_ENDPOINT;
  const accessKeyId = process.env.UNDERCROFT_S3_ACCESS_KEY;
  const secretAccessKey = process.env.UNDERCROFT_S3_SECRET_KEY;
  return new LakeStore(
    new S3ObjectStore({
      bucket: required("UNDERCROFT_S3_BUCKET_RAW"),
      ...(endpoint === undefined ? {} : { endpoint }),
      ...(accessKeyId !== undefined && secretAccessKey !== undefined
        ? { accessKeyId, secretAccessKey }
        : {}),
    }),
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      tenant: { type: "string" },
      concurrency: { type: "string" },
    },
  });
  // parseInt, not Number(): a count of requests in flight, not an amount.
  const concurrency = Number.parseInt(values.concurrency ?? `${DEFAULT_CONCURRENCY}`, 10);
  if (!(concurrency >= 1)) {
    throw new Error("--concurrency must be a whole number of at least 1");
  }
  const pool = createPool(required("UNDERCROFT_POSTGRES_DSN"));
  try {
    const outcome = await compactLake(
      {
        exec: asExecutor(pool),
        lake: openLake(),
        specsDir:
          process.env.UNDERCROFT_SPECS_DIR ??
          join(import.meta.dirname, "..", "..", "..", "specs", "connectors"),
        log: createLogger({ component: "lake-compaction" }),
        concurrency,
      },
      { apply: values.apply, tenantId: values.tenant ?? null },
    );
    const removed = outcome.streams.reduce((sum, stream) => sum + stream.removed, 0);
    const verb = outcome.apply ? "removed" : "would remove";
    process.stdout.write(
      `${verb} ${removed} observation(s) across ${outcome.streams.length} stream(s)\n`,
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
