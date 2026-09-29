/**
 * One entity's watermark for the length of one read: how the read starts, how far it got, and
 * writing that back.
 *
 * Split from `runPaths.ts` so the read loop there says only "start here, note this, save", and
 * the rules a watermark answers to live in one place:
 *
 * - **It belongs to the request that read it.** It is read, and written back, only under the
 *   request this run sends; a request changed since -- a spec edit or a scope -- finds none and
 *   reads everything once (ADR 0072).
 * - **It is the highest stamp seen, not the last.** A source is not obliged to sort its pages by
 *   the field it is filtered on, and a mark taken from the final record of an unordered read
 *   skips everything below it forever (`laterStamp`).
 * - **It vouches only for what the source's filter can see.** Xero documents edits its filter
 *   never returns, so a connection may RE-SYNC: read its lists whole on a schedule of its own,
 *   measured from the start of the run that last read each list whole (ADR 0081).
 * - **A whole read spends from the day's budget, and waits when there is none.** A list that
 *   holds a watermark then reads what changed instead, from the reserve, so ordinary edits still
 *   arrive; a list with no watermark to fall back on is not read at all this run, and the run
 *   says so. A whole read the budget cuts short saves nothing, so the list is still due next run.
 *
 * WHEN to {@link StreamCursor.save} is the caller's decision and deliberately not this module's:
 * only after a read got to the end, so a read that threw or stopped never moves the mark.
 */

import {
  laterStamp,
  type ReadEnd,
  type RequestBudget,
  requestKey,
} from "@undercroft/connector-runtime";
import { type ConnectorEntity, type ConnectorSpec, wholeReadDue } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";

import type { StreamIdentity } from "../repos/rawRecords.ts";
import { readSyncCursor, writeSyncCursor } from "../repos/syncCursor.ts";
import type { DayBudget } from "./dayBudget.ts";
import type { SpecRun } from "./specRun.ts";

export interface StreamCursor {
  /** The watermark to send, or `null` for a whole read. */
  readonly since: string | null;
  /** The list must be read whole and the day has nothing left for it: it is not read this run. */
  readonly waiting: boolean;
  /** What the read's requests are admitted and counted by; absent where nothing is rationed. */
  readonly budget: RequestBudget | undefined;
  /** Take one record's incremental value into account. */
  readonly observe: (incrementalAt: string | null) => void;
  /**
   * Write back how far a read that got to the end got. A read the budget cut short, and one that
   * carried no stamp at all, write nothing.
   */
  readonly save: (end: ReadEnd) => Promise<void>;
}

/** A cursor for an entity that keeps no watermark: read whole, every run, like any other read. */
function everyRun(day: DayBudget | null): StreamCursor {
  return {
    since: null,
    waiting: false,
    budget: day?.watching,
    observe: () => undefined,
    save: () => Promise.resolve(),
  };
}

export async function openStreamCursor(
  exec: SqlExecutor,
  at: {
    readonly spec: ConnectorSpec;
    readonly entity: ConnectorEntity;
    readonly stream: StreamIdentity;
    readonly runId: string;
    readonly run: Pick<SpecRun, "resync" | "day">;
  },
): Promise<StreamCursor> {
  const { incremental } = at.entity;
  const { resync, day } = at.run;
  if (incremental === undefined) {
    return everyRun(day);
  }
  const reading = { format: incremental.format, requestKey: requestKey(at.spec, at.entity) };
  const stored = await readSyncCursor(exec, at.stream, reading);
  const room = day === null || day.hasRoom();
  const since =
    stored === null || (room && wholeReadDue(resync, stored.wholeReadAt, resync.runStartedAt))
      ? null
      : stored.watermark;
  let mark: string | null = null;
  return {
    since,
    waiting: since === null && !room,
    budget: since === null ? day?.whole : day?.watching,
    observe: (incrementalAt): void => {
      mark = laterStamp(incremental.format, mark, incrementalAt);
    },
    save: async (end): Promise<void> => {
      if (end.exhausted || mark === null) {
        return;
      }
      const wholeRead = since === null ? { runId: at.runId, requests: end.requests } : null;
      await writeSyncCursor(exec, at.stream, { ...reading, watermark: mark }, wholeRead);
    },
  };
}
