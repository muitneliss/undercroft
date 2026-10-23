/**
 * A dashboard's shared filters and the parameters they bind.
 *
 * A filter is a named hole every question on the dashboard may reach for: a text or a
 * number filter named `stage` binds `{{stage}}`, and a date range named `period` binds
 * two, `{{period_from}}` and `{{period_to}}`, because a range is two literals in SQL and
 * the compiler binds one value per name. The values live in the URL, as a question's own
 * parameters do (`lib/params.ts`), so a dashboard with its filters set is a link.
 *
 * The date presets count the viewer's own days (ADR 0149): "today" is the day on the reader's
 * clock, the same clock `lib/when.ts` prints every instant on, so "last 7 days" ends on the
 * date the screen beside it shows as today.
 */

import type { DashboardFilter } from "@undercroft/contracts/bi";

/** The two parameters a date range named `name` binds. */
export function rangeParams(name: string): { from: string; to: string } {
  return { from: `${name}_from`, to: `${name}_to` };
}

/** The parameter names one filter binds, in the order a form shows them. */
export function paramsOf(filter: DashboardFilter): string[] {
  if (filter.kind === "date_range") {
    const range = rangeParams(filter.name);
    return [range.from, range.to];
  }
  return [filter.name];
}

export function paramsOfAll(filters: readonly DashboardFilter[]): string[] {
  return filters.flatMap(paramsOf);
}

export const DATE_PRESETS = ["last7", "last30", "thisMonth", "thisYear"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

/**
 * `YYYY-MM-DD` of a local calendar day. `Date`'s own getters read the runtime's zone at the
 * moment they are called, so there is no formatter here to capture a zone and keep it.
 */
function isoDate(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/**
 * The local day `days` before `now`'s, counted in calendar days rather than in 24-hour steps:
 * across a daylight-saving change a day is 23 or 25 hours, and subtracting milliseconds from
 * just after midnight would land on the wrong date. `Date` rolls a day of 0 or below back into
 * the month before.
 */
function daysBefore(now: Date, days: number): string {
  return isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
}

/** The preset's range, both ends inclusive, ending today. */
export function presetRange(preset: DatePreset, now = new Date()): { from: string; to: string } {
  const to = isoDate(now);
  switch (preset) {
    case "last7":
      return { from: daysBefore(now, 6), to };
    case "last30":
      return { from: daysBefore(now, 29), to };
    case "thisMonth":
      return { from: `${to.slice(0, 7)}-01`, to };
    case "thisYear":
      return { from: `${to.slice(0, 4)}-01-01`, to };
    default: {
      const exhaustive: never = preset;
      throw new Error(`unhandled preset ${String(exhaustive)}`);
    }
  }
}
