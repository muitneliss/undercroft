/**
 * How often a source is read, in the reader's words -- and what a cron expression will do.
 *
 * Four presets and `custom`, a five-field cron expression evaluated in Singapore time. The
 * words and the rule are the server's (`@undercroft/contracts/cadence`); this module names the
 * presets and words the rule's answers.
 *
 * NO CRON-TO-PROSE TRANSLATOR, deliberately. One that is subtly wrong about a schedule is
 * worse than the five fields an operator can read, and twice as bad in two languages, because
 * only one of its answers ever gets checked. What confirms an expression instead is
 * `previewCron`: the next three instants it fires at, as dates, computed by the same function
 * the scheduler uses. A reader can check a date; nobody checks a paraphrase. ADR 0059.
 *
 * The check is the server's own `checkCron`, imported from the browser-safe subpath, so what
 * this form lets an admin save is exactly what the server will keep.
 */

import {
  checkCron,
  type CronRefusal,
  PRESET_CADENCES,
  type PresetCadence,
  SCHEDULER_TICK_MINUTES,
  upcomingFires,
} from "@undercroft/contracts/cadence";
import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import type { Connection } from "@/api/types.ts";
import { formatWeekdayDateTime } from "@/lib/when.ts";

export type Cadence = Connection["cadence"];

/** What a card asks the server to store: a preset alone, or `custom` with its expression. */
export type CadenceChoice =
  | { readonly cadence: PresetCadence }
  | { readonly cadence: "custom"; readonly cron: string };

/** In the order a `<select>` offers them: most often first, paused, then write-your-own. */
export const CADENCES: readonly Cadence[] = [...PRESET_CADENCES, "custom"] as const;

/** How many fires the preview lists: enough to see a weekday pattern, few enough to read. */
export const PREVIEW_FIRES = 3;

/** The scheduler's tick in minutes, for the sentences that promise it. */
export const TICK_MINUTES: number = SCHEDULER_TICK_MINUTES;

const KEY: Record<
  Cadence,
  "when.hourly" | "when.every6h" | "when.daily" | "when.paused" | "when.custom"
> = {
  hourly: "when.hourly",
  every_6h: "when.every6h",
  daily: "when.daily",
  paused: "when.paused",
  custom: "when.custom",
};

export function describeCadence(t: TFunction, cadence: Cadence): string {
  return t(KEY[cadence]);
}

const PRESETS: ReadonlySet<string> = new Set(PRESET_CADENCES);

/** Whether a `<select>` value is one of the presets, which save the moment they are chosen. */
export function isPresetCadence(value: string): value is PresetCadence {
  return PRESETS.has(value);
}

const REFUSAL_KEY: Record<
  CronRefusal,
  | "grant.cronRefused.fields"
  | "grant.cronRefused.invalid"
  | "grant.cronRefused.never"
  | "grant.cronRefused.tooFrequent"
> = {
  fields: "grant.cronRefused.fields",
  invalid: "grant.cronRefused.invalid",
  never: "grant.cronRefused.never",
  "too-frequent": "grant.cronRefused.tooFrequent",
};

/** What an expression typed into the card will do, or why it cannot be saved. */
export type CronPreview =
  /** Nothing typed yet: no refusal to show, and nothing to save. */
  | { readonly state: "empty" }
  | { readonly state: "refused"; readonly reason: string }
  /** `cron` is the form the server will store; `fires` are worded dates, SGT. */
  | { readonly state: "ok"; readonly cron: string; readonly fires: readonly string[] };

export function previewCron(
  t: TFunction,
  locale: Locale,
  expression: string,
  now: Date = new Date(),
): CronPreview {
  if (expression.trim() === "") {
    return { state: "empty" };
  }
  const checked = checkCron(expression);
  if (!checked.ok) {
    return {
      state: "refused",
      reason: t(REFUSAL_KEY[checked.reason], { minutes: TICK_MINUTES }),
    };
  }
  return {
    state: "ok",
    cron: checked.cron,
    fires: upcomingFires(checked.cron, now, PREVIEW_FIRES).map((fire) =>
      formatWeekdayDateTime(fire, locale),
    ),
  };
}
