/**
 * How often a connected source is read, and when it is next due.
 *
 * A cadence is one of four presets or `custom`, a five-field cron expression an administrator
 * writes. The presets stay because most admins want "every hour" or "once a day" and should
 * not have to spell it; the cron is for the ones who need "07:30 on weekdays", which no short
 * list can hold. This module used to refuse cron outright; ADR 0059 records why that changed
 * and what was rejected on the way.
 *
 * NOTHING MAKES A CRON FIRE BUT THE TICK. Kestra asks the worker what is due every
 * `SCHEDULER_TICK_MS` and starts exactly that; this module answers "due". So a preset is a
 * lower bound on the gap between two runs, a cron is the instant a run becomes due, and in
 * both cases the tick is how late a run may start past it. That is why a cron whose fires can
 * fall closer together than one tick is refused rather than stored: it would be a promise the
 * scheduler cannot keep, and the card would print fires the ledger never shows.
 *
 * ONE ZONE. A cron is evaluated in `SCHEDULE_ZONE`, Asia/Singapore -- the zone every schedule
 * the UI prints is rendered in (`apps/ui/src/lib/when.ts`), whatever the reader's language. A
 * cron read in one zone beside times rendered in another is how "0 9" becomes an hour off.
 * Singapore keeps no daylight saving, so no fire is ever skipped or doubled by a clock change.
 *
 * STANDARD CRON, EXACTLY FIVE FIELDS: minute, hour, day of month, month, day of week (Sunday
 * is 0). When both day fields are restricted a day matches if EITHER does -- Vixie cron's
 * rule, and `croner`'s `domAndDow: false` -- so "0 9 1 * 1" is the 1st of the month AND every
 * Monday. A six- or seven-field pattern would add seconds or years: seconds the tick cannot
 * honour, years a schedule that silently ends. `?` is refused because `croner` reads it as
 * "the value at the moment of parsing", which would make one stored string a different
 * schedule on every read. The day-field extensions `croner` supports (`L`, `W`, `#`) are
 * accepted: they are still five fields, and the preview an admin reads before saving shows
 * what they mean.
 *
 * `nextRunAt` is the one rule for "when does this pair run next", shared by the card that
 * prints it and the due list that acts on it. Two copies of a schedule rule disagree
 * eventually, and the disagreement reads as a card that says "next run at 09:00" beside a
 * ledger with nothing in it.
 *
 * Browser-safe on purpose (`@undercroft/contracts/cadence`): the UI checks an expression and
 * previews its fires with these same functions, so what the form accepts is what the server
 * stores. Nothing here may import a Node built-in; `bun run build:ui` is the gate on that.
 */

import { Cron } from "croner";
import { z } from "zod";

import { needsScope } from "./connectionScope.ts";

/** The zone every cron is evaluated in, and every schedule time is printed in. */
export const SCHEDULE_ZONE = "Asia/Singapore";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * How often Kestra asks what is due: every five minutes (`flows/ingest_due.yml`).
 *
 * Stated here because two rules lean on it: a cron may not fire more often than this, and
 * "due now" on a card means "within one tick". Change the flow and this together. In minutes
 * as well, for the sentences that promise it to a person.
 */
export const SCHEDULER_TICK_MINUTES = 5;
export const SCHEDULER_TICK_MS: number = SCHEDULER_TICK_MINUTES * MINUTE_MS;

/** The choices that need no expression, in the order a `<select>` offers them. */
export const PRESET_CADENCES = ["hourly", "every_6h", "daily", "paused"] as const;

export const CADENCES = [...PRESET_CADENCES, "custom"] as const;

export const Cadence = z.enum(CADENCES);
export type Cadence = z.infer<typeof Cadence>;
export type PresetCadence = (typeof PRESET_CADENCES)[number];

/** The gap between the start of one run and the moment the next is due. */
export const CADENCE_INTERVAL_MS: Readonly<Record<Exclude<PresetCadence, "paused">, number>> = {
  hourly: HOUR_MS,
  every_6h: HOUR_MS * 6,
  daily: DAY_MS,
};

/**
 * Why an expression was refused, as a code a caller words.
 *
 * - `fields`: not exactly five whitespace-separated fields (empty included).
 * - `invalid`: five fields, but not a cron expression -- a minute of 61, a word, a `?`.
 * - `never`: a valid expression that names no instant, such as 31 February.
 * - `too-frequent`: two fires can fall closer together than one scheduler tick.
 */
export const CRON_REFUSALS = ["fields", "invalid", "never", "too-frequent"] as const;
export type CronRefusal = (typeof CRON_REFUSALS)[number];

export type CronCheck =
  | { readonly ok: true; readonly cron: string }
  | { readonly ok: false; readonly reason: CronRefusal };

const WHITESPACE = /\s+/u;
const FIELD_COUNT = 5;

/**
 * A fixed midnight in `SCHEDULE_ZONE`, for the two checks that must not depend on the day
 * they run: whether an expression ever fires, and how close its fires can fall.
 */
const REFERENCE_MIDNIGHT = new Date("2026-01-01T00:00:00+08:00");

/** The one set of `croner` options, so checking, previewing and scheduling cannot disagree. */
const CRON_OPTIONS = { timezone: SCHEDULE_ZONE, domAndDow: false, mode: "5-part" } as const;

function fieldsOf(expression: string): string[] {
  return expression.trim().split(WHITESPACE);
}

/** A parsed schedule, or `null` for anything that is not five fields `croner` accepts. */
function parseCron(expression: string): Cron | null {
  const fields = fieldsOf(expression);
  if (fields.length !== FIELD_COUNT || expression.includes("?")) {
    return null;
  }
  try {
    // No callback, so nothing is scheduled: this is an evaluator, never a timer.
    return new Cron(fields.join(" "), CRON_OPTIONS);
  } catch {
    return null;
  }
}

/**
 * The closest two fires of this expression's TIMES OF DAY can fall, midnight included.
 *
 * The day and month fields are widened to every day before measuring. That only ever adds
 * fires, and adding fires only ever narrows a gap, so the answer is a floor under the real
 * expression's closest pair: an expression passing here cannot beat the tick on any day. It
 * refuses a few patterns whose close pair could never land on two consecutive firing days --
 * "23:58 and 00:02, on the 1st only" -- and that strictness is the price of an answer that
 * does not depend on which month a sample happened to cover.
 *
 * One full day of fires plus the first of the next is enough, because a widened pattern fires
 * at the same times every day. It stops at the first gap under the tick, so the dense case is
 * the cheap one; the densest pattern that passes (every five minutes) is 289 steps.
 */
function closestGapMs(minute: string, hour: string): number {
  const everyDay = new Cron(`${minute} ${hour} * * *`, CRON_OPTIONS);
  const end = REFERENCE_MIDNIGHT.getTime() + DAY_MS;
  let previous = everyDay.nextRun(new Date(REFERENCE_MIDNIGHT.getTime() - 1));
  let closest = Number.POSITIVE_INFINITY;
  while (previous !== null && previous.getTime() <= end && closest >= SCHEDULER_TICK_MS) {
    const next = everyDay.nextRun(previous);
    if (next === null) {
      break;
    }
    closest = Math.min(closest, next.getTime() - previous.getTime());
    previous = next;
  }
  return closest;
}

/**
 * Whether an expression may be stored, and the form it is stored in.
 *
 * The stored form is the fields joined by single spaces, so "0  9 * * *" typed with a double
 * space is saved as the expression it means rather than as the keystrokes.
 */
export function checkCron(expression: string): CronCheck {
  const fields = fieldsOf(expression);
  if (fields.length !== FIELD_COUNT) {
    return { ok: false, reason: "fields" };
  }
  const schedule = parseCron(expression);
  if (schedule === null) {
    return { ok: false, reason: "invalid" };
  }
  if (schedule.nextRun(REFERENCE_MIDNIGHT) === null) {
    return { ok: false, reason: "never" };
  }
  const [minute = "", hour = ""] = fields;
  if (closestGapMs(minute, hour) < SCHEDULER_TICK_MS) {
    return { ok: false, reason: "too-frequent" };
  }
  return { ok: true, cron: fields.join(" ") };
}

/**
 * The next `count` fires strictly after `after`, as ISO instants.
 *
 * Empty for an expression that does not parse or never fires; a caller that needs to know
 * WHY asks `checkCron`. This is what an admin reads before saving -- the confirmation that
 * "30 7 * * 1-5" means what they think it means, in dates rather than in a paraphrase.
 */
export function upcomingFires(expression: string, after: Date, count: number): string[] {
  const schedule = parseCron(expression);
  if (schedule === null) {
    return [];
  }
  return schedule.nextRuns(count, after).map((fire) => fire.toISOString());
}

/** A cadence as stored: a preset carries no expression, `custom` always carries one. */
export type CadenceSetting =
  | { readonly cadence: PresetCadence; readonly cron: null }
  | { readonly cadence: "custom"; readonly cron: string };

export type CadenceSettingResult =
  | { readonly ok: true; readonly setting: CadenceSetting }
  | { readonly ok: false; readonly reason: "cron-refused"; readonly refusal: CronRefusal }
  | { readonly ok: false; readonly reason: "cron-without-custom" };

/**
 * Turn what a caller sent into what may be stored, or say why not.
 *
 * `custom` without an expression is refused as `fields` -- the empty string is not five of
 * them. A preset WITH an expression is refused rather than quietly dropping it: a caller who
 * sent both believes a cron was saved, and a stored preset beside that belief is a schedule
 * nobody chose.
 */
export function cadenceSetting(input: {
  readonly cadence: Cadence;
  readonly cron?: string | null | undefined;
}): CadenceSettingResult {
  const cron = input.cron ?? "";
  if (input.cadence !== "custom") {
    return cron.trim() === ""
      ? { ok: true, setting: { cadence: input.cadence, cron: null } }
      : { ok: false, reason: "cron-without-custom" };
  }
  const checked = checkCron(cron);
  return checked.ok
    ? { ok: true, setting: { cadence: "custom", cron: checked.cron } }
    : { ok: false, reason: "cron-refused", refusal: checked.reason };
}

/** What deciding a schedule needs to know about one (tenant, source) pair. */
export interface ScheduleFacts {
  readonly source: string;
  /** `ops.connection.status`, as stored. Anything but `connected` never runs. */
  readonly status: string;
  readonly cadence: Cadence;
  /** `ops.connection.cron`: the expression when `cadence` is `custom`, otherwise `null`. */
  readonly cron: string | null;
  /** The chosen scope as JSON text; a scoped source with none chosen never runs. */
  readonly selectionJson: string;
  /** When the newest ingest run of this pair started, or `null` when there has been none. */
  readonly lastRunStartedAt: string | null;
}

/** When the run after one that started at `last` is due, or `null` for "never again". */
type FollowingRun = (last: Date) => Date | null;

/**
 * The rule a cadence follows, or `null` when it runs nothing.
 *
 * A CRON is due at its first fire strictly AFTER the last run started. Everything missed while
 * the platform was down is therefore caught up by exactly one run -- the fire after the last
 * start is in the past, so the pair is due at the next tick -- and never replayed fire by fire.
 * A run started by hand counts: it satisfies every fire before it.
 *
 * A stored custom cadence whose expression no longer parses is a defect, not a schedule, and
 * answers `null`: visibly no next run and never due, rather than a guessed one. The migration's
 * CHECK keeps an expression beside every `custom` and `checkCron` kept it valid when it was
 * written; a parser upgrade that reads it differently is what this guards.
 */
function followingRunFor(cadence: Cadence, cron: string | null): FollowingRun | null {
  switch (cadence) {
    case "paused":
      return null;
    case "custom": {
      const schedule = cron === null ? null : parseCron(cron);
      return schedule === null ? null : (last): Date | null => schedule.nextRun(last);
    }
    default: {
      const gap = CADENCE_INTERVAL_MS[cadence];
      return (last): Date => new Date(last.getTime() + gap);
    }
  }
}

/**
 * When this pair is next due, as an ISO instant, or `null` when nothing will run.
 *
 * Null is a fact, not an absence: the source is disconnected, paused, still waiting for
 * somebody to choose what may be read, or holds an expression that no longer parses. A pair
 * that has never run is due now, whatever its cadence -- the value is `now`, and a reader that
 * finds it in the past should read "at the scheduler's next tick".
 */
export function nextRunAt(facts: ScheduleFacts, now: Date): string | null {
  if (facts.status !== "connected" || needsScope(facts.source, facts.selectionJson)) {
    return null;
  }
  const following = followingRunFor(facts.cadence, facts.cron);
  if (following === null) {
    return null;
  }
  if (facts.lastRunStartedAt === null) {
    return now.toISOString();
  }
  const last = new Date(facts.lastRunStartedAt);
  if (Number.isNaN(last.getTime())) {
    // A ledger timestamp that does not parse is a defect, not a schedule. Treating it as
    // "never ran" starts a run and writes a readable one.
    return now.toISOString();
  }
  return following(last)?.toISOString() ?? null;
}

/**
 * Whether the scheduler should start this pair at this tick.
 *
 * A run already in progress is never due, whatever the clock says: the ledger's unique index
 * would refuse the second one anyway, and asking is a 409 the flow then has to ignore.
 */
export function isDue(
  facts: ScheduleFacts & { readonly lastRunStatus: string | null },
  now: Date,
): boolean {
  if (facts.lastRunStatus === "running") {
    return false;
  }
  const next = nextRunAt(facts, now);
  return next !== null && new Date(next).getTime() <= now.getTime();
}
