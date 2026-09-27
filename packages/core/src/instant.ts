/**
 * The instant a source's timestamp text names, or `null` when it names none unambiguously.
 *
 * Two spellings are read, and nothing else:
 *
 * - **ISO-8601 with a `Z` or an explicit offset**, handed back exactly as it arrived. Postgres
 *   reads it as the same instant, and re-rendering it through `Date` would drop microseconds.
 * - **A Microsoft JSON date**, `/Date(1573755038314+0000)/`, which is what Xero writes in every
 *   date field of its Accounting API. It is rendered as ISO-8601 UTC. The count is milliseconds
 *   since the UTC epoch whatever follows it: the offset records where it was written and does
 *   not move it.
 *
 * Everything else is `null`, including text `Date.parse` would happily accept. A date with no
 * time, or a time with no offset, names a moment only in a timezone the text does not give;
 * `"March 7"` becomes 2001 in the host's zone; and Bun rolls `2026-02-30` over to March. Each
 * of those is a guess that would reach a `timestamptz` column looking like a fact, where
 * `NULL` is visibly "the source did not say". Issue #265 is what passing the text straight
 * through cost instead: one `/Date(...)/` sent the whole Xero run down on its first page.
 */

const ISO =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.\d+)?)?(?:Z|[+-](?<offsetHours>\d{2}):(?<offsetMinutes>\d{2}))$/u;
const MS_JSON_DATE = /^\/Date\((?<count>-?\d+)(?:[+-]\d{4})?\)\/$/u;

/** Postgres accepts an offset up to fifteen hours fifty-nine. */
const MAX_OFFSET_HOURS = 15;
const MAX_OFFSET_MINUTES = 59;

/** The millisecond count inside a Microsoft JSON date, or `null` for any other text. */
export function msJsonDateMillis(text: string): bigint | null {
  const count = MS_JSON_DATE.exec(text)?.groups?.count;
  return count === undefined ? null : BigInt(count);
}

/** A millisecond count as ISO-8601 UTC, or `null` past the range a `Date` can hold. */
export function isoFromMillis(ms: bigint): string | null {
  // `parseInt` of the digits, not `Number()`: the money rule bans `Number()` repo-wide, and
  // this is a count of milliseconds rather than an amount.
  const date = new Date(Number.parseInt(ms.toString(), 10));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isoInstant(text: string): string | null {
  const ms = msJsonDateMillis(text);
  if (ms !== null) {
    return isoFromMillis(ms);
  }
  const groups = ISO.exec(text)?.groups;
  return groups !== undefined && namesARealMoment(groups) ? text : null;
}

/** False for a field out of range, such as the 30th of February or hour 24. */
function namesARealMoment(groups: Readonly<Record<string, string | undefined>>): boolean {
  const year = field(groups, "year");
  const month = field(groups, "month");
  const day = field(groups, "day");
  const hour = field(groups, "hour");
  const minute = field(groups, "minute");
  const second = field(groups, "second");
  const offsetHours = field(groups, "offsetHours");
  const offsetMinutes = field(groups, "offsetMinutes");
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month - 1 &&
    at.getUTCDate() === day &&
    at.getUTCHours() === hour &&
    at.getUTCMinutes() === minute &&
    at.getUTCSeconds() === second &&
    offsetHours <= MAX_OFFSET_HOURS &&
    offsetMinutes <= MAX_OFFSET_MINUTES
  );
}

/** An optional group that did not match -- seconds, or an offset where `Z` stood -- is zero. */
function field(groups: Readonly<Record<string, string | undefined>>, name: string): number {
  return Number.parseInt(groups[name] ?? "0", 10);
}
