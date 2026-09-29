/**
 * One entity's watermark for the length of one read: where the read starts, how far it got, and
 * writing that back.
 *
 * Split from `runPaths.ts` so the read loop there says only "start here, note this, save", and
 * the three rules a watermark answers to live in one place:
 *
 * - **It belongs to the request that read it.** It is read, and written back, only under the
 *   request this run sends; a request changed since -- a spec edit or a scope -- finds none and
 *   reads everything once (ADR 0072).
 * - **It is the highest stamp seen, not the last.** A source is not obliged to sort its pages by
 *   the field it is filtered on, and a mark taken from the final record of an unordered read
 *   skips everything below it forever (`laterStamp`).
 * - **It vouches only for what the source's filter can see.** An entity whose spec declares
 *   `wholeReadAfterHours` is read whole, with no watermark, once the run that last read it whole
 *   is that old, because a source such as Xero documents edits its filter never returns
 *   (ADR 0080). Any read that sent no watermark records its run as the last whole read.
 *
 * WHEN to {@link StreamCursor.save} is the caller's decision and deliberately not this module's:
 * only after a read got to the end, so a read that threw or stopped never moves the mark.
 */

import { laterStamp, requestKey } from "@undercroft/connector-runtime";
import { type ConnectorEntity, type ConnectorSpec, SCHEDULER_TICK_MS } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";

import type { StreamIdentity } from "../repos/rawRecords.ts";
import { readSyncCursor, type WholeReadBound, writeSyncCursor } from "../repos/syncCursor.ts";

export interface StreamCursor {
  /** The watermark to send, or `null` for a whole read. */
  readonly since: string | null;
  /** Take one record's incremental value into account. */
  readonly observe: (incrementalAt: string | null) => void;
  /** Write back how far the read got. A read that carried no stamp at all writes nothing. */
  readonly save: () => Promise<void>;
}

const HOUR_MS = 3_600_000;

/**
 * How recent this entity's last whole read must be for its watermark to be trusted, or
 * `undefined` when its spec trusts the watermark always.
 *
 * ONE SCHEDULER TICK SHORT OF THE DECLARED HOURS. A cron fires at an instant, and the tick is how
 * late a run may start past it (`cadence.ts`), so two runs of a daily `0 9 * * *` can start a few
 * minutes less than 24 hours apart. Measured exactly, that run would find its last whole read
 * short of a day old and trust the mark, and the list would be read whole every second day. The
 * tick's slack is what makes "every 24 hours" hold for a schedule that fires every 24 hours.
 */
function wholeReadBound(entity: ConnectorEntity, runId: string): WholeReadBound | undefined {
  const hours = entity.incremental?.wholeReadAfterHours;
  return hours === undefined ? undefined : { runId, maxAgeMs: hours * HOUR_MS - SCHEDULER_TICK_MS };
}

/** A cursor for an entity that reads whole every run and keeps no watermark. */
const NONE: StreamCursor = {
  since: null,
  observe: () => undefined,
  save: () => Promise.resolve(),
};

export async function openStreamCursor(
  exec: SqlExecutor,
  at: {
    readonly spec: ConnectorSpec;
    readonly entity: ConnectorEntity;
    readonly stream: StreamIdentity;
    readonly runId: string;
  },
): Promise<StreamCursor> {
  const { incremental } = at.entity;
  if (incremental === undefined) {
    return NONE;
  }
  const reading = { format: incremental.format, requestKey: requestKey(at.spec, at.entity) };
  const since = await readSyncCursor(exec, at.stream, reading, wholeReadBound(at.entity, at.runId));
  // A read that sent no watermark read the stream whole, whatever the reason it did.
  const wholeReadBy = since === null ? at.runId : null;
  let mark: string | null = null;
  return {
    since,
    observe: (incrementalAt): void => {
      mark = laterStamp(incremental.format, mark, incrementalAt);
    },
    save: async (): Promise<void> => {
      if (mark !== null) {
        await writeSyncCursor(exec, at.stream, { ...reading, watermark: mark }, wholeReadBy);
      }
    },
  };
}
