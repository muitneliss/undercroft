/**
 * Keep every tenant's BM25 search indexes built, valid and lean.
 *
 *   task db:search-index          one pass, then exit (a person, against UNDERCROFT_POSTGRES_DSN)
 *   bun run search-index --repeat  a pass now and every six hours (the `search-index` service)
 *
 * What a pass does, and the rules it decides by, are `services/searchIndexing.ts`'s; this file
 * only reads the environment, holds the connection and keeps time.
 *
 * WHY THE SERVICE REPEATS RATHER THAN EXITS (ADR 0156). The deploy is `docker compose up --wait`,
 * and a one-shot container that nothing depends on fails `--wait` when it has already exited by
 * the time compose looks -- measured on Compose v5.5.0: `container ... exited (0)`, exit status 1
 * -- while one still running passes. A pass with nothing to do exits in about a second, so a
 * one-shot `search-index` would fail every ordinary deploy. Making something depend on it would
 * make the deploy wait for the first build, which can take many minutes. So the service stays up:
 * a pass at start, then one every six hours, which is also the schedule the growth-triggered
 * reindex needs between releases. `cd:verify` then reads it as the long-running service it is.
 *
 * As the bootstrap role, like `db-migrate`: building on `raw.document_text` needs its owner.
 */

import process from "node:process";
import { createLogger, describeError } from "@undercroft/core";
import { asExecutor, createPool } from "./pool.ts";
import { indexSearch } from "./services/searchIndexing.ts";

/** Between two passes of the service. The growth rule needs no finer schedule than this. */
const PASS_EVERY_MS = 6 * 60 * 60 * 1000;
/** When another pass holds the lock -- a killed container's backend finishing its build. */
const RETRY_LOCKED_MS = 5 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  const dsn = process.env.UNDERCROFT_POSTGRES_DSN;
  if (dsn === undefined || dsn === "") {
    throw new Error("UNDERCROFT_POSTGRES_DSN is required");
  }
  const repeat = process.argv.includes("--repeat");
  const log = createLogger({ component: "search-index" });

  const pool = createPool(dsn);
  // One connection for the whole life of the process: the advisory lock and the serial
  // setting belong to a session, and a pool would hand each statement whichever it had free.
  const client = await pool.connect();
  try {
    const exec = asExecutor(client);
    for (;;) {
      const pass = await indexSearch({ exec, log });
      const failed = pass.actions.filter((a) => a.action === "failed").length;
      log.info("search_index.pass", { ran: pass.ran, indexes: pass.actions.length, failed });
      if (!repeat) {
        if (failed > 0) {
          process.exitCode = 1;
        }
        return;
      }
      await sleep(pass.ran ? PASS_EVERY_MS : RETRY_LOCKED_MS);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    createLogger({ component: "search-index" }).error("search_index.crashed", describeError(error));
    process.exit(1);
  });
}
