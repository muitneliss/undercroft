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
 * tens of thousands of rows per run; `progress` is therefore coalesced to one per event per
 * entity per {@link PROGRESS_INTERVAL_MS} off an injected `Clock`, and the whole run is
 * capped at {@link MAX_EVENTS_PER_RUN}. Past the cap only `warn` and `error` get through --
 * and the truncation itself is recorded, because a store that prunes without saying so is
 * indistinguishable from one that lost the rows (`.claude/rules/raw-lake.md`).
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

/** How often one entity's progress is worth a row. A run is minutes; this is not. */
export const PROGRESS_INTERVAL_MS = 2000;

/**
 * How many events one run may record. A feed is evidence, not a log file: 200 lines is more
 * than any run's milestones and far less than its messages.
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

export function createRunJournal(deps: RunJournalDeps): RunJournal {
  const clock = deps.clock ?? systemClock;
  const pending: RunEvent[] = [];
  const lastProgressAt = new Map<string, number>();
  let accepted = 0;
  let truncationNoted = false;
  // Serialises the writes so the rows land in the order the events happened, and gives
  // `flush` one thing to await.
  let chain: Promise<void> = Promise.resolve();

  function write(): Promise<void> {
    const batch = pending.splice(0, pending.length);
    if (batch.length === 0) {
      return Promise.resolve();
    }
    return recordEvents(deps.exec, deps.runId, batch).catch((error: unknown) => {
      // The run is not failed over its own narration. Said out loud rather than swallowed:
      // stdout is still a channel, and "the feed is short" needs a reason somewhere.
      deps.log?.warn("run_events_unwritten", { count: batch.length, ...describeError(error) });
    });
  }

  function push(level: RunEvent["level"], event: string, fields: EventFields): void {
    const { entity, ...rest } = fields;
    const detail: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (!LOG_ONLY.has(key)) {
        detail[key] = value;
      }
    }
    pending.push({
      at: clock.now().toISOString(),
      level,
      event,
      entity: entity ?? null,
      detail,
    });
    chain = chain.then(write);
  }

  /**
   * Whether this event gets a row.
   *
   * A milestone below the cap always does. Above it, only a `warn` or an `error` does --
   * and the first thing refused buys one `events_truncated` row so the feed says it is
   * short rather than looking complete.
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
     * A progress line, if the last one for this entity is old enough.
     *
     * Dropped silently, and that is the one place silence is right: the line it replaces
     * said the same thing about the same entity a moment ago, and the next one will say it
     * again. Nothing is lost, which is what distinguishes this from pruning.
     */
    progress(event, fields = {}): void {
      const key = `${event}:${fields.entity ?? ""}`;
      const nowMs = clock.now().getTime();
      const last = lastProgressAt.get(key);
      if (last !== undefined && nowMs - last < PROGRESS_INTERVAL_MS) {
        return;
      }
      lastProgressAt.set(key, nowMs);
      note("info", event, fields);
    },

    async flush(): Promise<void> {
      chain = chain.then(write);
      await chain;
    },
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
