/**
 * Dates, in the operator's terms.
 *
 * Two rules carried over from `@/lib/money`, for the same reason: a value we do
 * not have renders as MISSING rather than as a plausible-looking default, and a
 * value we cannot read is reported as unreadable rather than coerced into
 * something that looks like a date.
 *
 * Everything is formatted in Asia/Singapore because that is the zone the
 * platform's schedules are written in. Rendering an expiry in the reader's
 * local zone while the cron beside it is in Singapore time is how someone
 * concludes a grant has a day longer than it has.
 */

import { MISSING } from "@/lib/money.ts";

const ZONE = "Asia/Singapore";

const DATE = new Intl.DateTimeFormat("en-SG", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: ZONE,
});

const DATE_TIME = new Intl.DateTimeFormat("en-SG", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: ZONE,
});

function parse(iso: string | null | undefined): Date | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? DATE.format(date) : MISSING;
}

export function formatDateTime(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? DATE_TIME.format(date) : MISSING;
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
export function expiryNote(iso: string | null | undefined, now = new Date()): string {
  if (!iso) {
    return "No expiry recorded";
  }

  const days = daysUntil(iso, now);
  if (days === null) {
    return MISSING;
  }
  if (days < 0) {
    const ago = Math.abs(days);
    return ago === 1 ? "Lapsed yesterday" : `Lapsed ${String(ago)} days ago`;
  }
  if (days === 0) {
    return "Expires today";
  }
  if (days === 1) {
    return "Expires tomorrow";
  }
  return `Expires in ${String(days)} days`;
}

/**
 * A cron expression in words, for the handful of shapes this product writes.
 *
 * Deliberately narrow: it recognises a daily and an hourly schedule and returns
 * the expression itself for anything else. A general cron-to-English translator
 * that is subtly wrong about a schedule is worse than showing the operator the
 * five fields they already know how to read.
 */
export function describeSchedule(cron: string): string {
  const fields = cron.trim().split(/\s+/u);
  if (fields.length !== 5) {
    return cron.trim();
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const everyDay = dayOfMonth === "*" && month === "*" && dayOfWeek === "*";

  if (everyDay && hour === "*" && minute === "0") {
    return "Hourly";
  }

  if (everyDay && /^\d{1,2}$/u.test(hour ?? "") && /^\d{1,2}$/u.test(minute ?? "")) {
    const hh = (hour ?? "0").padStart(2, "0");
    const mm = (minute ?? "0").padStart(2, "0");
    return `Daily at ${hh}:${mm} SGT`;
  }

  return cron.trim();
}
