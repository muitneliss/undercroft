/**
 * How often a source is read, in the reader's words.
 *
 * Four presets and no cron string. The people choosing are a customer's administrators,
 * who want "every hour" and never "0 * * * *", and a cron translator that is subtly wrong
 * about a schedule is worse than the five fields an operator knows how to read -- twice as
 * bad in two languages, because only one of its answers ever gets checked. The server holds
 * the same four words (`@undercroft/contracts`); this module only names them.
 */

import type { TFunction } from "i18next";

import type { Connection } from "@/api/types.ts";

export type Cadence = Connection["cadence"];

/** In the order a `<select>` offers them: most often first, paused last. */
export const CADENCES: readonly Cadence[] = ["hourly", "every_6h", "daily", "paused"] as const;

const KEY: Record<Cadence, "when.hourly" | "when.every6h" | "when.daily" | "when.paused"> = {
  hourly: "when.hourly",
  every_6h: "when.every6h",
  daily: "when.daily",
  paused: "when.paused",
};

export function describeCadence(t: TFunction, cadence: Cadence): string {
  return t(KEY[cadence]);
}

/** Whether a `<select>` value is one of the four, so a form never sends a fifth. */
export function isCadence(value: string): value is Cadence {
  return CADENCES.some((cadence) => cadence === value);
}
