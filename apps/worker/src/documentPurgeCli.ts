/**
 * Trace and purge the documents landed before ADR 0161 -- a dry run unless told `--apply`.
 *
 *   task db:document-purge                                   report every tenant, change nothing
 *   task db:document-purge -- --tenant CASE-0042             one tenant
 *   task db:document-purge -- --tenant CASE-0042 --apply     trace, then delete what is settled
 *
 * A composition root beside `lakeCompactionCli.ts`, for its reason: it needs a DSN and the object
 * store, and `scripts/` cannot import the worker. It reads `UNDERCROFT_POSTGRES_DSN` (the worker's
 * own role: it updates `raw.documents`, as the extract pass does) and `UNDERCROFT_S3_BUCKET_RAW`
 * with its endpoint and keys. `docs/runbook/deployment.md`, "Purging document bytes", says how
 * they reach production.
 *
 * WHY A DRY RUN IS THE DEFAULT. This deletes the only copy we hold of a customer's files, and
 * the owner chose that knowing no backup is taken. The command a person types without thinking
 * must change nothing; the one that deletes must be spelled out.
 *
 * What it prints is JSON lines: one per step as it finishes, then one per tenant -- documents
 * already purged, what a purge would remove now (digests, documents, bytes) and what it keeps and
 * why. The digest list is in the lake's `_reports/blob-purge/`, not on a terminal; each document's
 * own record is its `bytes_purged_at`, `bytes_purge_outcome` and `bytes_purge_report`.
 */

import process from "node:process";
import { parseArgs } from "node:util";

import { asExecutor, createPool } from "@undercroft/db";
import { LakeStore, S3ObjectStore } from "@undercroft/lake";

import { DEFAULT_CONCURRENCY, purgeDocumentBytes } from "./services/documentBytesPurge.ts";

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

function line(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
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
    const outcome = await purgeDocumentBytes(
      { exec: asExecutor(pool), lake: openLake(), concurrency, progress: line },
      { apply: values.apply, tenantId: values.tenant ?? null },
    );
    for (const tenant of outcome.outlook) {
      line({ step: "outlook", apply: outcome.apply, ...tenant });
    }
    const { purged } = outcome;
    process.stdout.write(
      outcome.apply
        ? `purged ${purged.digests} digest(s), ${purged.bytes} bytes, from ${purged.documents} document(s)\n`
        : "dry run: nothing changed; pass --apply to trace and purge\n",
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
