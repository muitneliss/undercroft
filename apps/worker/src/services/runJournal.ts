/**
 * What a run says about itself while it is still running.
 *
 * The ledger in `ops.run` is written when a run CLOSES, which is the right shape for an
 * audit and the wrong one for somebody watching: an ingest that reads a mailbox one message
 * at a time is minutes or hours of a row that says `running` and five columns that say
 * nothing. The worker already narrates itself to stdout, but in production that is inside a
 * container the control plane cannot reach, so the narration never gets to the person who
 * asked for the run. This is the second channel, and the only one the browser can read.
 *
 * Three constraints shape it, and each is the reason for a decision below.
 *
 * **It must not cost the run anything.** A write here is fire-and-forget on a serialised
 * chain: `info` and `progress` return `void`, so a page loop pays nothing, and the chain
 * keeps the rows in the order the events happened. A failure to record evidence never fails
 * the work that produced it -- it is reported to the log and the run continues, because
 * losing a sync over a full disk in `ops` would be the tail wagging the dog.
 *
 * **It must not become the thing it is describing.** A progress line every message would be
 * tens of thousands of rows per run, so the two kinds of line are bounded differently -- and
 * the difference is what they ARE, not how important they are.
 *
 * A MILESTONE is a thing that happened, at an instant. It appends, it is never rewritten, and
 * a run is capped at {@link MAX_EVENTS_PER_RUN} of them; past the cap only `warn` and `error`
 * get through, and the truncation itself is recorded, because a store that prunes without
 * saying so is indistinguishable from one that lost the rows (`.claude/rules/raw-lake.md`).
 *
 * A PROGRESS line is a reading of a dial, and the next reading replaces it rather than adding
 * to it. It is coalesced to one per event per entity per {@link PROGRESS_INTERVAL_MS} off an
 * injected `Clock`, and then written to ONE row per `(run, event, entity)`, rewritten in place
 * (`210_run_event_live.sql`). So it is exempt from the cap: it cannot grow the table by running
 * longer, and capping it was what froze an hours-long ingest at whatever figure its
 * two-hundredth line happened to carry, for the remaining three hours of the run. ADR 0032.
 *
 * **It must not carry a payload.** `detail` is counts and opaque provider ids. A filename, a
 * mail subject or a folder name belongs in the lake manifest, which dbt and BI cannot reach;
 * `ops` is one grant away from a dashboard (`.claude/rules/pii.md`, ADR 0015). Nothing here
 * enforces that mechanically -- the call sites are the enforcement, which is why the events
 * are an enumerated set rather than free prose.
 */

import { type Clock, describeError, type Logger, systemClock } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { recordEvents, type RunEvent } from "@undercroft/db/repos";
import { annotate } from "@undercroft/telemetry";

/**
 * The fields of one event. `entity` becomes its own column; everything else is `detail`,
 * and everything else must be a count, an enumeration or an opaque provider id.
 */
export interface EventFields {
  readonly entity?: string;
  readonly [key: string]: unknown;
}

/**
 * The narrator, in the shape of the `Logger` beside it.
 *
 * `info`/`warn`/`error` are milestones and are always kept (subject to the cap);
 * `progress` is the one that may be dropped, because the next one says the same thing
 * better a moment later.
 */
export interface RunJournal {
  info: (event: string, fields?: EventFields) => void;
  warn: (event: string, fields?: EventFields) => void;
  error: (event: string, fields?: EventFields) => void;
  progress: (event: string, fields?: EventFields) => void;
  /** Settles once everything noted so far has been written, or reported as unwritten. */
  flush: () => Promise<void>;
}

export interface RunJournalDeps {
  readonly exec: SqlExecutor;
  readonly runId: string;
  /** Where the same line goes as JSONL. Absent means the feed only. */
  readonly log?: Logger;
  /** Injected in tests. Decides when a progress line is too soon to be worth a row. */
  readonly clock?: Clock;
}

/**
 * How often one entity's dial is worth re-reading.
 *
 * A second, not the two it was: a reading now overwrites its own row rather than appending, so
 * the cost of reading more often is one UPDATE of one row instead of a row per reading, and the
 * interval no longer has to trade liveness against the size of the table. The leaf polls at the
 * same interval -- reading faster than the worker writes would buy nothing.
 */
export const PROGRESS_INTERVAL_MS = 1000;

/**
 * How many MILESTONES one run may record. A feed is evidence, not a log file: 200 lines is more
 * than any run has milestones.
 *
 * Progress lines are not counted, because they cannot accumulate -- see the docstring above.
 */
export const MAX_EVENTS_PER_RUN = 200;

/** Recorded once, in place of the lines the cap refused. Never itself dropped. */
export const TRUNCATED = "events_truncated";

/**
 * Fields that reach the log and never the feed.
 *
 * `errorMessage` is a provider's or Postgres's own sentence, and those routinely embed the
 * value that caused them. The run's `error` column already keeps it, capped, in the one
 * place the interface renders it; a second copy inside a table of enumerated events is
 * exactly where a payload would first get in. Stripped by the writer rather than at each
 * call site, so it cannot arrive again with the next event somebody adds.
 */
const LOG_ONLY: ReadonlySet<string> = new Set(["errorMessage"]);

/** The pending rows and the chain that writes them, so `flush` has one thing to await. */
interface EventBuffer {
  readonly push: (event: RunEvent) => void;
  readonly flush: () => Promise<void>;
}

/**
 * Buffered, serialised writes.
 *
 * The chain is what keeps the rows in the order the events happened: each write waits on the
 * one before it. A write that fails does NOT fail the run -- a run is not failed over its own
 * narration -- but it is said out loud rather than swallowed, because "the feed is short"
 * needs a reason somewhere.
 */
function createEventBuffer(deps: RunJournalDeps): EventBuffer {
  const pending: RunEvent[] = [];
  let chain: Promise<void> = Promise.resolve();

  function write(): Promise<void> {
    const batch = pending.splice(0, pending.length);
    if (batch.length === 0) {
      return Promise.resolve();
    }
    return recordEvents(deps.exec, deps.runId, batch).catch((error: unknown) => {
      deps.log?.warn("run_events_unwritten", { count: batch.length, ...describeError(error) });
    });
  }

  return {
    push: (event): void => {
      pending.push(event);
      chain = chain.then(write);
    },
    flush: async (): Promise<void> => {
      chain = chain.then(write);
      await chain;
    },
  };
}

/** The `detail` column: everything the event carried except what only the log wants. */
function detailOf(fields: Omit<EventFields, "entity">): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!LOG_ONLY.has(key)) {
      detail[key] = value;
    }
  }
  return detail;
}

/**
 * Whether this dial is worth reading again yet: one reading per event per entity per
 * {@link PROGRESS_INTERVAL_MS}, off the injected clock.
 *
 * A reading refused here is lost silently, and that is the one place silence is right: the
 * one it would have replaced said the same thing about the same entity a moment ago, and the
 * next will say it again. Nothing is lost, which is what distinguishes this from pruning.
 *
 * Its own function because it is the rule that makes a reading a reading, and because a map
 * of last-seen instants is a thing to own rather than a variable to keep in view.
 */
function createPacing(clock: Clock): (event: string, entity: string | undefined) => boolean {
  const lastRead = new Map<string, number>();
  return (event, entity): boolean => {
    const key = `${event}:${entity ?? ""}`;
    const nowMs = clock.now().getTime();
    const last = lastRead.get(key);
    if (last !== undefined && nowMs - last < PROGRESS_INTERVAL_MS) {
      return false;
    }
    lastRead.set(key, nowMs);
    return true;
  };
}

export function createRunJournal(deps: RunJournalDeps): RunJournal {
  // Every run opens its journal inside the request that started it, so tagging that request's
  // span is what lets Tempo find a trace by run id. The run's own lines already carry the
  // trace id, through the logger. ADR 0058.
  annotate({ "undercroft.run_id": deps.runId });
  const clock = deps.clock ?? systemClock;
  const buffer = createEventBuffer(deps);
  const due = createPacing(clock);
  let accepted = 0;
  let truncationNoted = false;

  function push(level: RunEvent["level"], event: string, fields: EventFields, live = false): void {
    const { entity, ...rest } = fields;
    buffer.push({
      at: clock.now().toISOString(),
      level,
      event,
      entity: entity ?? null,
      detail: detailOf(rest),
      live,
    });
  }

  /**
   * Whether this event gets a row.
   *
   * A milestone below the cap always does. Above it, only a `warn` or an `error` does --
   * and the first thing refused buys one `events_truncated` row so the feed says it is
   * short rather than looking complete.
   *
   * A progress line never reaches here; it owns one row and cannot accumulate, so there is
   * nothing for a cap to protect the table from.
   */
  function admit(level: RunEvent["level"], event: string): boolean {
    if (accepted < MAX_EVENTS_PER_RUN || level !== "info") {
      accepted += 1;
      return true;
    }
    if (!truncationNoted) {
      truncationNoted = true;
      accepted += 1;
      push("warn", TRUNCATED, { at: MAX_EVENTS_PER_RUN, dropped: event });
    }
    return false;
  }

  function note(level: RunEvent["level"], event: string, fields: EventFields = {}): void {
    if (admit(level, event)) {
      push(level, event, fields);
    }
    deps.log?.write(level, event, fields);
  }

  return {
    info: (event, fields): void => note("info", event, fields),
    warn: (event, fields): void => note("warn", event, fields),
    error: (event, fields): void => note("error", event, fields),

    /**
     * A reading of this entity's dial, if the last one is old enough ({@link createPacing}).
     *
     * It does not go through `admit`, and that is the whole of the fix this file carries: a
     * reading overwrites its own row (`210_run_event_live.sql`), so however long a run goes
     * on it owns one row per entity and cannot crowd out a milestone. Counting it against a
     * cap bought nothing and cost the counter -- an ingest over a mailbox stopped saying
     * anything new seven minutes into three hours of work. ADR 0032.
     */
    progress(event, fields = {}): void {
      if (!due(event, fields.entity)) {
        return;
      }
      push("info", event, fields, true);
      deps.log?.write("info", event, fields);
    },

    flush: buffer.flush,
  };
}

/**
 * A journal that records nothing.
 *
 * Not a null object for tests -- for the callers that have no run to narrate: a Google
 * collector driven by something other than `runIngest`, which still wants one code path.
 */
export const SILENT_JOURNAL: RunJournal = {
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
  progress: (): void => undefined,
  flush: (): Promise<void> => Promise.resolve(),
};
