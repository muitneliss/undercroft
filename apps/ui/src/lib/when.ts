/**
 * Dates, in the reader's terms, in the reader's language and on the reader's clock.
 *
 * Two rules carried over from `@/lib/money`, for the same reason: a value we do
 * not have renders as MISSING rather than as a plausible-looking default, and a
 * value we cannot read is reported as unreadable rather than coerced into
 * something that looks like a date.
 *
 * **An instant is shown in the viewer's own zone** -- whatever the browser's runtime says it
 * is -- because that is the clock the reader holds it against (ADR 0149). A log line that says
 * 12:24 for something a reader in Hanoi did at 11:24, with no zone on the screen, is a wrong
 * value that looks right. **The locale still never moves the zone**: it changes the words and
 * the digits, and a Vietnamese-language reader in Singapore sees Singapore's clock.
 *
 * The one thing still written in Singapore time is a cron expression, because the server
 * evaluates it in `SCHEDULE_ZONE`; the form that takes one says so (`cronHint`, `cronZone`),
 * and the fires it previews are instants like any other, printed here in the reader's zone.
 *
 * The prose lives in `@/i18n`, not here. Every function that produces words takes
 * the `t` it should produce them with, which is also what lets a test assert the
 * sentence a reader actually sees rather than a key.
 */

import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import { MISSING } from "@/lib/money.ts";

/**
 * Which CLDR locale formats a date for each of our languages.
 *
 * `en-SG` rather than `en-US`: the platform's operators read day-month-year, and an
 * American-ordered date beside a Singapore-ordered one is how 03/04 becomes ambiguous.
 * It names an ordering, not a zone -- the zone is the viewer's, set below.
 */
const CLDR: Record<Locale, string> = { vi: "vi-VN", en: "en-SG" };

/** The shapes an instant is printed in, without their zone, which is added per call. */
const SHAPES = {
  date: { day: "2-digit", month: "short", year: "numeric" },
  dateTime: {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  },
  /**
   * Led by its weekday, for a cron's upcoming fires, where the weekday is the thing being
   * checked: "1-5" means Monday to Friday only if the reader can see which days the fires
   * land on.
   */
  weekdayDateTime: {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  },
  /**
   * Clock time to the second, with no date, for a list of instants that all belong to one
   * thing on one day -- the lines of a run's feed. Repeating the date on every line would
   * push the sentence, which is the part worth reading, off to the right. Seconds are kept:
   * a run's steps are seconds apart, and a feed whose lines all read 12:42 says nothing
   * about what followed what.
   */
  time: { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

type Shape = keyof typeof SHAPES;

const FORMATS = new Map<string, Intl.DateTimeFormat>();

/**
 * One formatter per shape, locale and zone, built once and kept.
 *
 * Constructing an `Intl.DateTimeFormat` is the expensive half of formatting one date, and a
 * schedule draws one per row, so formatters are cached. A formatter fixes its zone when it
 * is built, though, and the runtime's zone can change under a running page (the device
 * crosses a border; a test sets `TZ`). So the zone is read on every call and is part of the
 * key, and the formatter is built with that zone named explicitly, so the key and what the
 * formatter prints cannot disagree. Reading the zone builds a default formatter, which
 * measured about a fifteenth of the cost of the one it saves.
 */
function formatter(shape: Shape, locale: Locale): Intl.DateTimeFormat {
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const key = `${shape}/${locale}/${zone}`;
  const held = FORMATS.get(key);
  if (held) {
    return held;
  }
  const made = new Intl.DateTimeFormat(CLDR[locale], { ...SHAPES[shape], timeZone: zone });
  FORMATS.set(key, made);
  return made;
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAs(shape: Shape, iso: string | null | undefined, locale: Locale): string {
  const date = parse(iso);
  return date ? formatter(shape, locale).format(date) : MISSING;
}

export function formatDate(iso: string | null | undefined, locale: Locale): string {
  return formatAs("date", iso, locale);
}

export function formatDateTime(iso: string | null | undefined, locale: Locale): string {
  return formatAs("dateTime", iso, locale);
}

export function formatWeekdayDateTime(iso: string | null | undefined, locale: Locale): string {
  return formatAs("weekdayDateTime", iso, locale);
}

export function formatTime(iso: string | null | undefined, locale: Locale): string {
  return formatAs("time", iso, locale);
}

const DAY_MS = 86_400_000;

/**
 * Whole days between now and an instant. Negative means it is in the past.
 *
 * Returns null for a missing or unreadable value, so a caller has to decide what
 * absence looks like instead of receiving a `0` that reads as "today".
 */
export function daysUntil(iso: string | null | undefined, now = new Date()): number | null {
  const date = parse(iso);
  if (!date) {
    return null;
  }
  return Math.round((date.getTime() - now.getTime()) / DAY_MS);
}

/**
 * How an expiry reads on the schedule.
 *
 * A credential with no recorded expiry is not expiring -- a HubSpot private-app
 * token genuinely never does -- so it says so rather than showing a dash that
 * looks like missing data.
 */
export function expiryNote(t: TFunction, iso: string | null | undefined, now = new Date()): string {
  if (!iso) {
    return t("when.noExpiry");
  }

  const days = daysUntil(iso, now);
  if (days === null) {
    return MISSING;
  }
  if (days < 0) {
    const ago = Math.abs(days);
    return ago === 1 ? t("when.lapsedYesterday") : t("when.lapsedDays", { count: ago });
  }
  if (days === 0) {
    return t("when.expiresToday");
  }
  if (days === 1) {
    return t("when.expiresTomorrow");
  }
  return t("when.expiresInDays", { count: days });
}

const RELATIVE = new Map<Locale, Intl.RelativeTimeFormat>();

function relativeFormat(locale: Locale): Intl.RelativeTimeFormat {
  const held = RELATIVE.get(locale);
  if (held) {
    return held;
  }
  const made = new Intl.RelativeTimeFormat(CLDR[locale], { numeric: "auto" });
  RELATIVE.set(locale, made);
  return made;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/** Past this, "34 days ago" tells a reader less than the date does. */
const RELATIVE_HORIZON_MS: number = 30 * DAY_MS;

/**
 * How long ago an instant was, in the reader's language: "5 phút trước", "2 hours ago".
 *
 * For the run column, where "just now" and "yesterday" are what an operator on a call
 * wants and a timestamp is what they would have to convert. Past thirty days the date
 * itself is the better answer, in the reader's zone like every other date here. Unreadable is MISSING, never "now".
 */
export function relativeTime(
  iso: string | null | undefined,
  locale: Locale,
  now = new Date(),
): string {
  const date = parse(iso);
  if (!date) {
    return MISSING;
  }
  const elapsed = now.getTime() - date.getTime();
  if (Math.abs(elapsed) >= RELATIVE_HORIZON_MS) {
    return formatDateTime(iso, locale);
  }
  const format = relativeFormat(locale);
  if (Math.abs(elapsed) < MINUTE_MS) {
    return format.format(0, "second");
  }
  if (Math.abs(elapsed) < HOUR_MS) {
    return format.format(-Math.round(elapsed / MINUTE_MS), "minute");
  }
  if (Math.abs(elapsed) < DAY_MS) {
    return format.format(-Math.round(elapsed / HOUR_MS), "hour");
  }
  return format.format(-Math.round(elapsed / DAY_MS), "day");
}

/**
 * When a key was last used, or that it never was.
 *
 * "Never" is a fact worth its own words: a dash reads as data nobody recorded, and the
 * question an admin is asking of this column is whether the key can be revoked safely.
 */
export function lastUsedNote(
  t: TFunction,
  locale: Locale,
  iso: string | null | undefined,
  now = new Date(),
): string {
  if (iso === null || iso === undefined) {
    return t("when.neverUsed");
  }
  return relativeTime(iso, locale, now);
}

type DurationUnit = "second" | "minute" | "hour";

const DURATION = new Map<string, Intl.NumberFormat>();

function durationFormat(locale: Locale, unit: DurationUnit): Intl.NumberFormat {
  const key = `${locale}/${unit}`;
  const held = DURATION.get(key);
  if (held) {
    return held;
  }
  const made = new Intl.NumberFormat(CLDR[locale], {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: unit === "hour" ? 1 : 0,
  });
  DURATION.set(key, made);
  return made;
}

/**
 * How long a run took, in the reader's language: "12 giây", "2 min", "1.5 hr".
 *
 * A run still in progress has no duration and gets MISSING, not a count that is still
 * growing; so does a pair of instants that cannot be read or that run backwards.
 */
export function formatDuration(startedAt: string, endedAt: string | null, locale: Locale): string {
  const start = parse(startedAt);
  const end = parse(endedAt);
  if (start === null || end === null) {
    return MISSING;
  }
  const ms = end.getTime() - start.getTime();
  if (ms < 0) {
    return MISSING;
  }
  if (ms < MINUTE_MS) {
    return durationFormat(locale, "second").format(ms / 1000);
  }
  if (ms < HOUR_MS) {
    return durationFormat(locale, "minute").format(ms / MINUTE_MS);
  }
  return durationFormat(locale, "hour").format(ms / HOUR_MS);
}

/** A calendar day as a date input gives it: `2026-10-31`. */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * The last second of a calendar day in the viewer's zone, as an ISO instant -- how "until the
 * 31st" is sent for a grant's expiry (ADR 0141, ADR 0149). In the zone every date here is
 * printed in, so the day a reader picked is the day the list then shows them.
 *
 * A date-time with no offset is read as local time by `Date` (ECMA-262's date-time string
 * format), which is exactly the viewer's zone, daylight saving included -- so no offset is
 * computed here. `null` for a value that is not a calendar day, rather than a guessed instant.
 */
export function endOfLocalDay(day: string): string | null {
  if (!CALENDAR_DAY.test(day) || parse(`${day}T00:00:00Z`) === null) {
    return null;
  }
  return new Date(`${day}T23:59:59`).toISOString();
}
