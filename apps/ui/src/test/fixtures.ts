/**
 * Test fixtures for the pure presentation logic.
 *
 * A `Connection` has many fields the connection-state logic never reads; this builder fills
 * them with inert defaults so a test can state only the fields under test. It is not a
 * network fake -- the kept tests exercise pure functions, not components, so they need no
 * server.
 */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import type { Connection, RunDetail, RunView, Source } from "@/api/types.ts";
import type { LastRun } from "@/lib/runs.ts";

/** One line of the journal: an ingest that landed, a little before the when-tests' `NOW`. */
export function run(over: Partial<RunView> = {}): RunView {
  return {
    id: "run-1",
    kind: "ingest",
    source: "hubspot",
    entities: ["deals"],
    status: "ok",
    trigger: "schedule",
    startedAt: "2026-09-17T11:00:00Z",
    endedAt: "2026-09-17T11:02:00Z",
    counts: { landed: 1234, created: 1000, changed: 200, unchanged: 34, refused: 0 },
    testsFailed: null,
    error: null,
    parentRunId: null,
    ...over,
  };
}

/** A run's full detail, as its leaf reads it: the line above plus an empty closed record. */
export function runDetail(over: Partial<RunDetail> = {}): RunDetail {
  return {
    ...run(),
    entityCounts: [],
    refusals: [],
    steps: [],
    parentRun: null,
    childRun: null,
    ...over,
  };
}

/** The other end of a chain: enough to name a run and link to it, never its own full detail. */
export function runLink(
  over: Partial<NonNullable<RunDetail["parentRun"]>> = {},
): NonNullable<RunDetail["parentRun"]> {
  return {
    id: "run-2",
    kind: "transform",
    source: null,
    status: "ok",
    testsFailed: null,
    ...over,
  };
}

/** A run that finished a little before the fixed `NOW` the when-tests use. */
export function lastRun(over: Partial<LastRun> = {}): LastRun {
  return {
    id: "run-1",
    status: "ok",
    startedAt: "2026-09-17T11:00:00Z",
    endedAt: "2026-09-17T11:02:00Z",
    seen: 12,
    refused: 0,
    error: null,
    ...over,
  };
}

export function connection(source: Source, over: Partial<Connection> = {}): Connection {
  return {
    source,
    status: "disconnected",
    externalAccountId: "",
    externalAccountLabel: "",
    scopes: [],
    config: {},
    cadence: "daily",
    nextRunAt: null,
    lastRun: null,
    expiresAt: null,
    ...over,
  };
}
