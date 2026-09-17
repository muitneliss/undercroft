/**
 * Observation stamps: `20260917T101501.004213Z`.
 *
 * Microsecond precision, not seconds, and not milliseconds.
 *
 * Second granularity looked sufficient and was not: two genuinely different versions of
 * the same document arriving within one second produced an identical stamp, and a
 * create-only store then refused the second one. That is correct behaviour applied to a
 * wrong key, and it rejects real data during a backfill or a rapid re-run.
 *
 * JavaScript makes this a live hazard rather than a settled question, because
 * `Date` resolves to milliseconds. Padding the fraction out to six digits with `000`
 * would restore exactly the collision the extra precision was introduced to fix, while
 * *looking* like it had been handled.
 *
 * ## The sub-millisecond digits are a counter, not a measurement
 *
 * Reading `hrtime.bigint()` would give more truthful-looking digits but no stronger
 * guarantee, and it cannot be driven by a test clock. What the lake actually needs is
 * that two stamps from one process are never equal and always ascend; so when the
 * clock has not advanced, the next stamp is simply the previous one plus one
 * microsecond. That is a disambiguator and is documented as one.
 *
 * Finer stamps cannot manufacture spurious versions, because identical bytes are caught
 * by content-idempotence before a stamp is ever generated. Still lexically sortable, so
 * ordering is unchanged -- which is what lets the loader page through the journal with
 * a plain `StartAfter`.
 */

import { type Clock, systemClock } from "./clock.ts";

const STAMP_PATTERN = /^\d{8}T\d{6}\.\d{6}Z$/;

const MICROS_PER_MS = 1_000;
const MICROS_PER_SECOND = 1_000_000;

export function isStamp(value: string): boolean {
  return STAMP_PATTERN.test(value);
}

function pad(value: number, width: number): string {
  return value.toString().padStart(width, "0");
}

/** Format a whole number of microseconds since the epoch as a stamp. */
export function formatStamp(micros: number): string {
  const seconds = Math.floor(micros / MICROS_PER_SECOND);
  const fraction = micros - seconds * MICROS_PER_SECOND;
  const date = new Date(seconds * 1000);
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}` +
    `T${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}${pad(date.getUTCSeconds(), 2)}` +
    `.${pad(fraction, 6)}Z`
  );
}

/** Parse a stamp back to microseconds since the epoch, or `null` if it is not one. */
export function parseStamp(stamp: string): number | null {
  if (!isStamp(stamp)) return null;
  const iso =
    `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}` +
    `T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  // `iso` carries whole seconds only, so `ms` is exactly seconds-in-milliseconds and
  // the full sub-second part comes from the stamp's own six digits.
  return ms * MICROS_PER_MS + parseInt(stamp.slice(16, 22), 10);
}

export interface StampSource {
  /** The next stamp. Strictly greater than every stamp this source has returned. */
  next(): string;
}

export function createStampSource(clock: Clock = systemClock): StampSource {
  let last = -1;
  return {
    next(): string {
      const fromClock = clock.now().getTime() * MICROS_PER_MS;
      const micros = fromClock > last ? fromClock : last + 1;
      last = micros;
      return formatStamp(micros);
    },
  };
}
