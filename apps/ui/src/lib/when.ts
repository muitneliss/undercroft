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

// biome-ignore-all lint/nursery/useValidTestTitle: The titles this flags are full sentences describing the promise under test -- "is clamped, so a hostile header cannot park a run for hours" -- which is exactly what the repo asks a test title to be. The rule wants a shorter shape.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and deliberately not done here: hoisting these literals touches many files and belongs in its own commit where the diff is reviewable, rather than buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/noMagicNumbers: What is left after the domain constants were named (see the WCAG block in acetate.ts) is structural: string slice offsets, the radix argument to parseInt, padStart widths, rounding factors. A name like SLICE_START_OF_GREEN_CHANNEL does not tell a reader anything the expression did not. The rule has no allow-list option, so it is per file or not at all.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import { MISSING } from "@/lib/money.ts";

const ZONE = "Asia/Singapore";

/**
 * Which CLDR locale formats a date for each of our languages.
 *
 * `en-SG` rather than `en-US`: the platform's operators read day-month-year, and an
 * American-ordered date beside a Singapore-ordered one is how 03/04 becomes ambiguous.
 */
const CLDR: Record<Locale, string> = { vi: "vi-VN", en: "en-SG" };

const DATE = new Map<Locale, Intl.DateTimeFormat>();
const DATE_TIME = new Map<Locale, Intl.DateTimeFormat>();

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

/**
 * A cron expression in words, for the handful of shapes this product writes.
 *
 * Deliberately narrow: it recognises a daily and an hourly schedule and returns
 * the expression itself for anything else. A general cron-to-English translator
 * that is subtly wrong about a schedule is worse than showing the operator the
 * five fields they already know how to read -- and a general cron-to-*two*-language
 * translator is worse still, because only one of its two answers ever gets checked.
 */
export function describeSchedule(t: TFunction, cron: string): string {
  const fields = cron.trim().split(/\s+/u);
  if (fields.length !== 5) {
    return cron.trim();
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const everyDay = dayOfMonth === "*" && month === "*" && dayOfWeek === "*";

  if (everyDay && hour === "*" && minute === "0") {
    return t("when.hourly");
  }

  if (everyDay && /^\d{1,2}$/u.test(hour ?? "") && /^\d{1,2}$/u.test(minute ?? "")) {
    const hh = (hour ?? "0").padStart(2, "0");
    const mm = (minute ?? "0").padStart(2, "0");
    return t("when.dailyAt", { time: `${hh}:${mm}` });
  }

  return cron.trim();
}
