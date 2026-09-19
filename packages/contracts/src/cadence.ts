/**
 * How often a connected source is read, and when it is next due.
 *
 * A cadence is one of four words, not a cron string. The people choosing it are a customer's
 * administrators, who want "every hour" or "once a day" and never "0 2 * * *"; a cron column
 * would also be a promise nobody keeps, because Kestra owns the tick and nothing in this
 * database can make a five-field expression fire. The scheduler asks the worker for what is
 * due every fifteen minutes and starts exactly that, so the cadence is a lower bound on the
 * gap between two runs and the tick is how late a run can start past it.
 *
 * `nextRunAt` is the one rule for "when does this pair run next", shared by the card that
 * prints it and the due list that acts on it. Two copies of a schedule rule disagree
 * eventually, and the disagreement reads as a card that says "next run at 09:00" beside a
 * ledger with nothing in it.
 */

import { z } from "zod";

import { needsScope } from "./connectionScope.ts";

export const CADENCES = ["hourly", "every_6h", "daily", "paused"] as const;

export const Cadence = z.enum(CADENCES);
export type Cadence = z.infer<typeof Cadence>;

const HOUR_MS = 3_600_000;

/** The gap between the start of one run and the moment the next is due. */
export const CADENCE_INTERVAL_MS: Readonly<Record<Exclude<Cadence, "paused">, number>> = {
  hourly: HOUR_MS,
  every_6h: HOUR_MS * 6,
  daily: HOUR_MS * 24,
};

/** What deciding a schedule needs to know about one (tenant, source) pair. */
export interface ScheduleFacts {
  readonly source: string;
  /** `ops.connection.status`, as stored. Anything but `connected` never runs. */
  readonly status: string;
  readonly cadence: Cadence;
  /** The chosen scope as JSON text; a scoped source with none chosen never runs. */
  readonly selectionJson: string;
  /** When the newest ingest run of this pair started, or `null` when there has been none. */
  readonly lastRunStartedAt: string | null;
}

/**
 * When this pair is next due, as an ISO instant, or `null` when nothing will run.
 *
 * Null is a fact, not an absence: the source is disconnected, paused, or still waiting for
 * somebody to choose what may be read. A pair that has never run is due now -- the value is
 * `now`, and a reader that finds it in the past should read "at the scheduler's next tick".
 */
export function nextRunAt(facts: ScheduleFacts, now: Date): string | null {
  if (facts.status !== "connected" || facts.cadence === "paused") {
    return null;
  }
  if (needsScope(facts.source, facts.selectionJson)) {
    return null;
  }
  if (facts.lastRunStartedAt === null) {
    return now.toISOString();
  }
  const last = new Date(facts.lastRunStartedAt).getTime();
  if (Number.isNaN(last)) {
    // A ledger timestamp that does not parse is a defect, not a schedule. Treating it as
    // "never ran" starts a run and writes a readable one.
    return now.toISOString();
  }
  return new Date(last + CADENCE_INTERVAL_MS[facts.cadence]).toISOString();
}

/**
 * Whether the scheduler should start this pair at this tick.
 *
 * A run already in progress is never due, whatever the clock says: the ledger's unique index
 * would refuse the second one anyway, and asking is a 409 the flow then has to ignore.
 */
export function isDue(
  facts: ScheduleFacts & { readonly lastRunStatus: string | null },
  now: Date,
): boolean {
  if (facts.lastRunStatus === "running") {
    return false;
  }
  const next = nextRunAt(facts, now);
  return next !== null && new Date(next).getTime() <= now.getTime();
}
