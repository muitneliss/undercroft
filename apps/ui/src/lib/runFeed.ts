/**
 * The feed, sorted into the two things it actually holds: readings and entries.
 *
 * A run narrates itself with two kinds of line, and printing them the same way is what made
 * the Journal's leaf a mile long. An ENTRY is a thing that happened at an instant -- the run
 * opened, an entity finished, dbt built fourteen models -- and it belongs in the ledger, in
 * order, forever. A READING is the current value of a dial: "928 of 7,786 messages". The next
 * reading does not add to it, it replaces it, and printing every one of them gave the leaf a
 * hundred and eighty copies of one sentence and told a screen reader about each.
 *
 * So a reading is not a line here. It is a gauge above the ledger, and there is one per entity
 * however long the run goes on. ADR 0032 records the same decision on the storage side.
 *
 * Which lines are readings comes from the server (`live`, set by `RunJournal.progress`). The
 * name list below is the compatibility half of that, for runs recorded before the column
 * existed; it is closed, and a new progress event never needs adding to it.
 */

import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import type { RunDetail, RunEventView } from "@/api/types.ts";
import { formatCount } from "@/lib/money.ts";
import { entityAccumulators, type EntityReading } from "@/lib/runFlowEntities.ts";

/**
 * Progress events recorded before `ops.run_event.live` existed (ADR 0032).
 *
 * Closed on purpose: anything written through `RunJournal.progress` from that release on
 * arrives carrying `live`, so this list never grows. It exists so a run in the ledger from
 * last month reads as one gauge rather than as two hundred sentences.
 */
const RECORDED_AS_PROGRESS: ReadonlySet<string> = new Set(["records_read", "documents_read"]);

/** Whether this line is the current value of a dial rather than a thing that happened. */
export function isReading(event: Pick<RunEventView, "event" | "live">): boolean {
  return event.live || RECORDED_AS_PROGRESS.has(event.event);
}

/**
 * One entity's dial, as the band above the ledger prints it.
 *
 * `share` is `null` whenever the denominator is unknown, and the band then draws no rule at
 * all. A bar whose full width stands for a total nobody has told us is a guess rendered in
 * pixels, and it is the most convincing kind: it looks exactly like a measurement. Rule 2.
 */
export interface RunGauge {
  readonly entity: string;
  readonly read: number | null;
  readonly total: number | null;
  /** How far along, 0 to 1, or `null` when there is no total to be a fraction of. */
  readonly share: number | null;
}

function shareOf(reading: EntityReading): number | null {
  const { read, total } = reading;
  if (read === null || total === null || total <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, read / total));
}

/**
 * The dials still moving: every entity the run has started and not finished.
 *
 * Built from `entityAccumulators`, which the flow diagram already uses, so the figure on the
 * gauge and the figure on the plate are one derivation read twice rather than two that can
 * disagree. A run that has closed has no moving dial, whatever its last reading said.
 */
export function runGauges(run: RunDetail, events: readonly RunEventView[]): RunGauge[] {
  if (run.status !== "running") {
    return [];
  }
  return entityAccumulators(run, events)
    .filter((acc) => acc.started && !acc.done)
    .map((acc) => ({
      entity: acc.entity,
      read: acc.read,
      total: acc.total,
      share: shareOf(acc),
    }));
}

/** The ledger: everything that happened, in order, with no reading among it. */
export function feedEntries(events: readonly RunEventView[]): RunEventView[] {
  return events.filter((event) => !isReading(event));
}

/**
 * What a gauge says in words: "928 / 7,786", or just the count when there is no total.
 *
 * Counts follow the reader's language (`formatCount`); the slash does not, because it is a
 * mark rather than a word. The same shape a stage's plate prints under its name.
 */
export function gaugeFigure(locale: Locale, gauge: RunGauge): string {
  const read = formatCount(gauge.read, locale);
  return gauge.total === null ? read : `${read} / ${formatCount(gauge.total, locale)}`;
}

/**
 * How far along, as a whole percent, floored.
 *
 * Floored rather than rounded so it cannot read 100% with work still to do -- the one number
 * on this band a reader would take as "done" -- and `null` when there is no total, where the
 * band prints the count alone.
 */
export function gaugeShare(t: TFunction, locale: Locale, gauge: RunGauge): string | null {
  if (gauge.share === null) {
    return null;
  }
  return t("journal.gauge.share", { share: formatCount(Math.floor(gauge.share * 100), locale) });
}
