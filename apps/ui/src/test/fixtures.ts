/**
 * Test fixtures for the pure presentation logic.
 *
 * A `Connection` has many fields the connection-state logic never reads; this builder fills
 * them with inert defaults so a test can state only the fields under test. It is not a
 * network fake -- the kept tests exercise pure functions, not components, so they need no
 * server.
 */

import { runVerdict } from "@undercroft/contracts/runs";
import { sourceKind } from "@undercroft/contracts/sources";

import {
  type Connection,
  type ConnectionWithConfig,
  isSource,
  type ModelDetail,
  type RunDetail,
  type RunView,
} from "@/api/types.ts";
import type { LastRun } from "@/lib/runs.ts";

/** A run's shape before its verdict is derived: the verdict only where an override names it. */
type Unverdicted<T extends { verdict: unknown }> = Omit<T, "verdict"> & Partial<Pick<T, "verdict">>;

/**
 * One line of the journal: an ingest that landed, a little before the when-tests' `NOW`.
 *
 * Its `verdict` is derived from the merged status and failing-test count, the way the server
 * derives it (`runVerdict`), so an override of `testsFailed` gets the verdict it comes to and a
 * fixture cannot claim a run the server would never answer.
 */
export function run(over: Partial<RunView> = {}): RunView {
  const line: Unverdicted<RunView> = {
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
  return { ...line, verdict: over.verdict ?? runVerdict(line.status, line.testsFailed) };
}

/** A run's full detail, as its leaf reads it: the line above plus an empty closed record. */
export function runDetail(over: Partial<RunDetail> = {}): RunDetail {
  const detail = {
    ...run(),
    entityCounts: [],
    refusals: [],
    reasonCounts: [],
    refusalsPruned: false,
    stepSummary: { total: 0, byStatus: { model: {}, test: {}, seed: {} }, problems: 0 },
    steps: [],
    nextStepCursor: null,
    parentRun: null,
    childRun: null,
    // A run from before a run recorded its scope, which is every run older than ADR 0091.
    scope: null,
    ...over,
  };
  return { ...detail, verdict: over.verdict ?? runVerdict(detail.status, detail.testsFailed) };
}

/** The other end of a chain: enough to name a run and link to it, never its own full detail. */
export function runLink(
  over: Partial<NonNullable<RunDetail["parentRun"]>> = {},
): NonNullable<RunDetail["parentRun"]> {
  const link = {
    id: "run-2",
    kind: "transform" as const,
    source: null,
    status: "ok" as const,
    testsFailed: null,
    ...over,
  };
  return { ...link, verdict: over.verdict ?? runVerdict(link.status, link.testsFailed) };
}

/**
 * A model with no test record -- never built, or built with no test attributed to it -- as
 * `models.get` answers it. Every count is `null`, never `0`: no record is not a passing one.
 */
export const NO_TEST_RECORD: ModelDetail["lastTests"] = {
  state: "unknown",
  failing: null,
  warnings: null,
  runId: null,
  endedAt: null,
  unpublished: null,
  failingTests: [],
  warningTests: [],
};

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
export function connection(source: string, over: Partial<Connection> = {}): ConnectionWithConfig {
  const kind = sourceKind(source);
  if (!isSource(kind)) {
    throw new Error(`fixture: ${source} is not an account of any kind the schedule lists`);
  }
  return {
    kind,
    source,
    status: "disconnected",
    ungranted: [],
    externalAccountId: "",
    externalAccountLabel: "",
    scopes: [],
    chosen: null,
    config: {},
    cadence: "daily",
    cron: null,
    nextRunAt: null,
    lastRun: null,
    expiresAt: null,
    resync: null,
    ...over,
  };
}
