/**
 * Where the stations sit, as numbers a test can read.
 *
 * A run is a line: its stages happen in one order, each exactly once, and nothing branches.
 * So the layout is one row, left to right, and this module is the whole of it -- kept out of
 * the component so the numbers can be asserted without a DOM.
 *
 * WIDTH IS MEASURED, NOT FIXED. Every plate used to be 204px wide, which cramped
 * "Chained into a model build" into the same box as "files". A plate is as wide as the
 * longest of its three lines, clamped, and the advances below are the two faces it sets:
 * Archivo 700 at 11px narrow for the caps, Spline Sans Mono at 15px for the datum. They are
 * estimates on purpose -- a layout that waits for the browser to measure text cannot be
 * computed during render, and a plate a few pixels generous costs nothing, while one that
 * waits a frame moves the whole row after the reader has already seen it.
 */

import type { RunStage } from "@/lib/runFlowTypes.ts";

/** A plate's box, and therefore the row: this draws one line of stages and only one. */
export const STATION_HEIGHT = 96;
/** The gap a connection spans from one plate to the next. Wide enough to read the flow in. */
export const STATION_GAP = 52;

const STATION_MIN = 152;
const STATION_MAX = 320;
const PAD_X = 15;
/** Archivo 700, 11px, `wdth` 84 -- the stage's name and the status mark's word. */
const CAPS_ADVANCE = 6.9;
/** The status mark's 13px glyph plus the `--s-2` gap before its word. */
const MARK_GLYPH = 21;
/**
 * Spline Sans Mono, 15px, tabular -- the datum, which is the plate's loudest line.
 *
 * 9.8 rather than the face's own 9.0 advance, because the datum is not all ASCII: the mono
 * face ships the latin subset only (see the faces note in `index.css`), so "bản ghi" falls
 * through to the system mono behind it at a wider advance. Measuring at 9.0 clipped every
 * Vietnamese count in the row to "338 bản ghi · 12 bị từ ch…".
 */
const MONO_ADVANCE = 9.8;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * How wide one plate has to be to print its three lines: the stage's name, its datum, and
 * the status mark with its word. Longer than {@link STATION_MAX} ellipsises rather than
 * pushing the row off the leaf.
 */
export function stationWidth(stage: RunStage): number {
  const name = stage.label.length * CAPS_ADVANCE;
  const mark = MARK_GLYPH + stage.markLabel.length * CAPS_ADVANCE;
  const datum = stage.detail === null ? 0 : stage.detail.length * MONO_ADVANCE;
  const content = Math.max(name, mark, datum);
  return clamp(Math.ceil(content) + PAD_X * 2, STATION_MIN, STATION_MAX);
}

/**
 * Which end of the row a plate is. It decides which of its two connectors is real: the first
 * plate has nothing arriving and the last has nothing leaving, and a connector wired to
 * nothing is the dangling hole the old drawing left on every plate at both ends.
 */
export type Place = "only" | "first" | "middle" | "last";

export interface Station {
  readonly stage: RunStage;
  readonly place: Place;
  readonly x: number;
  readonly width: number;
}

function placeOf(index: number, count: number): Place {
  if (count === 1) {
    return "only";
  }
  if (index === 0) {
    return "first";
  }
  return index === count - 1 ? "last" : "middle";
}

/** Every plate laid left to right, each as wide as its own content needs. */
export function railPlan(stages: readonly RunStage[]): readonly Station[] {
  const stations: Station[] = [];
  let x = 0;
  for (const [index, stage] of stages.entries()) {
    const width = stationWidth(stage);
    stations.push({ stage, place: placeOf(index, stages.length), x, width });
    x += width + STATION_GAP;
  }
  return stations;
}

/** The drawn width of the whole row. Never zero: a canvas needs a size. */
export function railWidth(stations: readonly Station[]): number {
  const last = stations.at(-1);
  return last === undefined ? 1 : last.x + last.width + STATION_GAP;
}
