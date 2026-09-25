/**
 * Test fixtures for the pure presentation logic.
 *
 * A `Connection` has many fields the connection-state logic never reads; this builder fills
 * them with inert defaults so a test can state only the fields under test. It is not a
 * network fake -- the kept tests exercise pure functions, not components, so they need no
 * server.
 */

import { sourceKind } from "@undercroft/contracts/sources";

import { type Connection, isSource, type RunDetail, type RunView } from "@/api/types.ts";
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
    // A run from before the stamp existed carries the same blank a build that did not say
    // does, which is the state the interface has to render either way.
    releaseTag: "",
    pendingBefore: null,
    ...over,
  };
}

/** A run's full detail, as its leaf reads it: the line above plus an empty closed record. */
export function runDetail(over: Partial<RunDetail> = {}): RunDetail {
  return {
    ...run(),
    entityCounts: [],
    refusals: [],
    reasonCounts: [],
    refusalsPruned: false,
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

/**
 * One card of the schedule, for `source` -- a kind (`gmail`) or a further account of one
 * (`gmail.3fa9c1d2e0ab`). Its `kind` is read off the source the way the server derives it, so
 * a fixture cannot claim a Drive source is a Gmail connection.
 */
export function connection(source: string, over: Partial<Connection> = {}): Connection {
  const kind = sourceKind(source);
  if (!isSource(kind)) {
    throw new Error(`fixture: ${source} is not an account of any kind the schedule lists`);
  }
  return {
    kind,
    source,
    status: "disconnected",
    externalAccountId: "",
    externalAccountLabel: "",
    scopes: [],
    config: {},
    cadence: "daily",
    cron: null,
    nextRunAt: null,
    lastRun: null,
    expiresAt: null,
    ...over,
  };
}
