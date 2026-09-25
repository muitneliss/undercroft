/**
 * Dates, in the operator's terms and in the operator's language.
 *
 * Two rules carried over from `@/lib/money`, for the same reason: a value we do
 * not have renders as MISSING rather than as a plausible-looking default, and a
 * value we cannot read is reported as unreadable rather than coerced into
 * something that looks like a date.
 *
 * Everything is formatted in Asia/Singapore because that is the zone the
 * platform's schedules are written in. Rendering an expiry in the reader's
 * local zone while the cron beside it is in Singapore time is how someone
 * concludes a grant has a day longer than it has. **The locale changes the words
 * and the digits, never the zone** -- a Vietnamese reader is an hour behind
 * Singapore, and showing them 09:00 for a schedule that fires at 09:00 SGT would
 * be exactly the mistake the fixed zone exists to prevent. That is why `dailyAt`
 * carries "SGT" in both catalogues.
 *
 * The prose lives in `@/i18n`, not here. Every function that produces words takes
 * the `t` it should produce them with, which is also what lets a test assert the
 * sentence a reader actually sees rather than a key.
 */

import { SCHEDULE_ZONE } from "@undercroft/contracts/cadence";
import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import { MISSING } from "@/lib/money.ts";

/**
 * The zone a cron is evaluated in, imported rather than restated: a second copy of it here is
 * how a schedule written for 09:00 would come to be printed at 08:00.
 */
const ZONE = SCHEDULE_ZONE;

/**
 * Which CLDR locale formats a date for each of our languages.
 *
 * `en-SG` rather than `en-US`: the platform's operators read day-month-year, and an
 * American-ordered date beside a Singapore-ordered one is how 03/04 becomes ambiguous.
 */
const CLDR: Record<Locale, string> = { vi: "vi-VN", en: "en-SG" };

const DATE = new Map<Locale, Intl.DateTimeFormat>();
const DATE_TIME = new Map<Locale, Intl.DateTimeFormat>();
const WEEKDAY_DATE_TIME = new Map<Locale, Intl.DateTimeFormat>();
const TIME = new Map<Locale, Intl.DateTimeFormat>();

/**
 * Formatters are built once per locale and kept.
 *
 * Constructing an `Intl.DateTimeFormat` is the expensive half of formatting one date, and a
 * schedule draws one per row. The module-level constants this replaces had the same
 * property; the map is what keeps it now that there is more than one locale.
 */
function dateFormat(locale: Locale): Intl.DateTimeFormat {
  const held = DATE.get(locale);
  if (held) {
    return held;
  }
  const made = new Intl.DateTimeFormat(CLDR[locale], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: ZONE,
  });
  DATE.set(locale, made);
  return made;
}

function dateTimeFormat(locale: Locale): Intl.DateTimeFormat {
  const held = DATE_TIME.get(locale);
  if (held) {
    return held;
  }
  const made = new Intl.DateTimeFormat(CLDR[locale], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: ZONE,
  });
  DATE_TIME.set(locale, made);
  return made;
}

/**
 * A date and time led by its weekday, in the fixed zone like everything else here.
 *
 * For a cron's upcoming fires, where the weekday is the thing being checked: "1-5" means
 * Monday to Friday only if the reader can see which days the fires land on.
 */
function weekdayDateTimeFormat(locale: Locale): Intl.DateTimeFormat {
  const held = WEEKDAY_DATE_TIME.get(locale);
  if (held) {
    return held;
  }
  const made = new Intl.DateTimeFormat(CLDR[locale], {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: ZONE,
  });
  WEEKDAY_DATE_TIME.set(locale, made);
  return made;
}

/**
 * Clock time to the second, with no date.
 *
 * For a list of instants that all belong to one thing on one day -- the lines of a run's
 * feed. Repeating the date on every line would push the sentence, which is the part worth
 * reading, off to the right. Seconds are kept: a run's steps are seconds apart, and a feed
 * whose lines all read 12:42 says nothing about what followed what.
 *
 * Same zone as everything else in this module, for the reason at the top of the file.
 */
function timeFormat(locale: Locale): Intl.DateTimeFormat {
  const held = TIME.get(locale);
  if (held) {
    return held;
  }
  const made = new Intl.DateTimeFormat(CLDR[locale], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: ZONE,
  });
  TIME.set(locale, made);
  return made;
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(iso: string | null | undefined, locale: Locale): string {
  const date = parse(iso);
  return date ? dateFormat(locale).format(date) : MISSING;
}

export function formatDateTime(iso: string | null | undefined, locale: Locale): string {
  const date = parse(iso);
  return date ? dateTimeFormat(locale).format(date) : MISSING;
}

export function formatWeekdayDateTime(iso: string | null | undefined, locale: Locale): string {
  const date = parse(iso);
  return date ? weekdayDateTimeFormat(locale).format(date) : MISSING;
}

export function formatTime(iso: string | null | undefined, locale: Locale): string {
  const date = parse(iso);
  return date ? timeFormat(locale).format(date) : MISSING;
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
 * itself is the better answer and it is formatted in the fixed zone like every other date
 * here. Unreadable is MISSING, never "now".
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
