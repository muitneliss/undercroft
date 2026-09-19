/**
 * A dashboard's shared filters and the parameters they bind.
 *
 * A filter is a named hole every question on the dashboard may reach for: a text or a
 * number filter named `stage` binds `{{stage}}`, and a date range named `period` binds
 * two, `{{period_from}}` and `{{period_to}}`, because a range is two literals in SQL and
 * the compiler binds one value per name. The values live in the URL, as a question's own
 * parameters do (`lib/params.ts`), so a dashboard with its filters set is a link.
 *
 * The date presets are computed in Asia/Singapore, the zone every schedule here is written
 * in (`lib/when.ts`): "today" for a reader in Hanoi at half past midnight is still the day
 * the platform is on, so a preset and the run that landed the rows agree on which day it is.
 */

// biome-ignore-all lint/style/noMagicNumbers: The span of each preset, in days, is the preset itself; and the slice offsets read a `YYYY-MM-DD` string whose shape is fixed by the formatter above them.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

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

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` in the platform's zone: `en-CA` is the CLDR locale whose short date is ISO. */
const ISO_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function isoDate(at: Date): string {
  return ISO_DATE.format(at);
}

/** The preset's range, both ends inclusive, ending today. */
export function presetRange(preset: DatePreset, now = new Date()): { from: string; to: string } {
  const to = isoDate(now);
  switch (preset) {
    case "last7":
      return { from: isoDate(new Date(now.getTime() - 6 * DAY_MS)), to };
    case "last30":
      return { from: isoDate(new Date(now.getTime() - 29 * DAY_MS)), to };
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
