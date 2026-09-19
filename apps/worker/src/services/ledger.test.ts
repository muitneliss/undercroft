/**
 * An external batch's refusals reach the ledger with their reasons -- CLAUDE.md rule 2 for
 * the callers that are not the worker's own runtime.
 */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { claimExternal, recordExternal } from "./ledger.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-0042')");
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

describe("recording an external batch", () => {
  it("a refused record is a row with its reason, and the run says how many", async () => {
    await claimExternal(db, { runId: "ext-1", tenantId: "CASE-0042", source: "csv" });
    await recordExternal(db, "ext-1", {
      created: 1,
      unchanged: 0,
      failed: 1,
      results: [
        { entity: "deals", sourceRecordId: "1", status: "created" },
        { entity: "deals", sourceRecordId: "2", status: "failed", reason: "key is not a stamp" },
      ],
    });

    const refusals = await db.query<{ source_record_id: string; reason: string }>(
      "SELECT source_record_id, reason FROM ops.run_refusal WHERE run_id = 'ext-1'",
    );
    expect(refusals.rows).toEqual([{ source_record_id: "2", reason: "key is not a stamp" }]);
    const run = await db.query<{ refused: number; status: string }>(
      "SELECT refused, status FROM ops.run WHERE id = 'ext-1'",
    );
    expect(run.rows[0]).toEqual({ refused: 1, status: "failed" });
  });

  it("a batch with nothing refused writes no refusal row", async () => {
    await claimExternal(db, { runId: "ext-2", tenantId: "CASE-0042", source: "csv" });
    await recordExternal(db, "ext-2", {
      created: 1,
      unchanged: 0,
      failed: 0,
      results: [{ entity: "deals", sourceRecordId: "1", status: "created" }],
    });
    const { rows } = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM ops.run_refusal WHERE run_id = 'ext-2'",
    );
    expect(rows[0]?.n).toBe("0");
  });
});
