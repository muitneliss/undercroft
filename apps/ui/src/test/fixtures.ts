/**
 * Test fixtures for the pure presentation logic.
 *
 * A `Connection` has many fields the connection-state logic never reads; this builder fills
 * them with inert defaults so a test can state only the fields under test. It is not a
 * network fake -- the kept tests exercise pure functions, not components, so they need no
 * server.
 */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import type { Connection, Source } from "@/api/types.ts";
import type { LastRun } from "@/lib/runs.ts";

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
