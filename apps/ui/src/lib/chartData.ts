/**
 * A query result as series: what a chart draws, and beside it what a reader may read.
 *
 * Every dataset carries `values[]` for the canvas -- floats, made by `plotValue` -- and
 * `raw[]` for the eye: the original cell text, every digit. A tooltip prints `raw`, a bar
 * is `values` tall. The two never cross.
 *
 * Which columns mean what: `chart.x` is the label column, else the first column that is
 * not numeric, else the first column; `chart.y` are the value columns, else every numeric
 * column that is not x. With `chart.series`, the rows are pivoted -- one dataset per
 * distinct value of that column, over the first y -- and past seven the rest fold into
 * "Other", so a chart with fifty customers is still a chart. A null is a gap, never a zero.
 */

import type { ChartConfig } from "@undercroft/contracts/bi";

import type { TableResult } from "@/api/types.ts";
import type { Cell } from "@/lib/cells.ts";
import { isNumericType, plotValue } from "@/lib/plot.ts";
import { CATEGORICAL, colourFor, OTHER } from "@/lib/plotPalette.ts";

export interface Dataset {
  readonly label: string;
  /** Plot positions. `null` is a gap. */
  readonly values: (number | null)[];
  /** The readable figure behind each position, or null for a gap or a folded sum. */
  readonly raw: (string | null)[];
  readonly colour: string;
}

export interface Series {
  readonly labels: string[];
  readonly datasets: Dataset[];
  /** Which columns were used, so the options panel can say. */
  readonly x: string | null;
  readonly y: string[];
}

/** The most series a chart draws by name. The palette has as many slots. */
export const MAX_SERIES: number = CATEGORICAL.length;

function rawOf(cell: Cell): string | null {
  if (cell === null) {
    return null;
  }
  return typeof cell === "string" ? cell : String(cell);
}

function labelOf(cell: Cell): string {
  return cell === null ? "" : String(cell);
}

/** The columns a chart will use, resolved from the config against what the result has. */
export function resolveColumns(
  result: TableResult,
  chart: ChartConfig,
): { x: string | null; y: string[]; series: string | null } {
  const names = result.columns.map((c) => c.name);
  const numeric = result.columns.filter((c) => isNumericType(c.type)).map((c) => c.name);
  const x =
    chart.x !== undefined && names.includes(chart.x)
      ? chart.x
      : (names.find((n) => !numeric.includes(n)) ?? names[0] ?? null);
  const chosenY = chart.y.filter((name) => names.includes(name));
  const y = chosenY.length > 0 ? chosenY : numeric.filter((n) => n !== x);
  const series = chart.series !== undefined && names.includes(chart.series) ? chart.series : null;
  return { x, y, series };
}

function index(result: TableResult, name: string | null): number {
  return name === null ? -1 : result.columns.findIndex((c) => c.name === name);
}

function typeAt(result: TableResult, at: number): string {
  return result.columns[at]?.type ?? "";
}

/** One dataset per y column, rows in order: the plain case. */
function byColumns(result: TableResult, x: number, y: string[]): Series {
  const labels = result.rows.map((row) => labelOf(x < 0 ? null : (row[x] ?? null)));
  const datasets = y.map((name, i) => {
    const at = index(result, name);
    const type = typeAt(result, at);
    return {
      label: name,
      values: result.rows.map((row) => plotValue(row[at] ?? null, type)),
      raw: result.rows.map((row) => rawOf(row[at] ?? null)),
      colour: colourFor(i),
    };
  });
  return { labels, datasets, x: result.columns[x]?.name ?? null, y };
}

/**
 * One dataset per distinct value of the series column, over the first y: the pivot case.
 * Series beyond the palette fold into "Other" by summing positions; the folded raw is
 * null, because a sum of floats is not a figure anybody may read.
 */
interface SeriesRequest {
  readonly result: TableResult;
  readonly x: number;
  readonly seriesAt: number;
  readonly yName: string;
  readonly otherLabel: string;
}

/**
 * The two axes of the pivot, in the order the rows first mention them.
 *
 * Row order, never sorted: the query said what order it wanted, and a chart that re-sorts an
 * `ORDER BY` is a chart that disagrees with the table beside it.
 */
function axesOf(
  result: TableResult,
  x: number,
  seriesAt: number,
): { labels: string[]; names: string[] } {
  const labels: string[] = [];
  const names: string[] = [];
  for (const row of result.rows) {
    const label = labelOf(x < 0 ? null : (row[x] ?? null));
    if (!labels.includes(label)) {
      labels.push(label);
    }
    const name = labelOf(row[seriesAt] ?? null);
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return { labels, names };
}

/** One empty dataset per kept series, plus the fold's own when there is one. */
function emptySeries(
  labels: readonly string[],
  kept: readonly string[],
  otherLabel: string | null,
): Dataset[] {
  const datasets: Dataset[] = kept.map((name, i) => ({
    label: name,
    values: labels.map(() => null),
    raw: labels.map(() => null),
    colour: colourFor(i),
  }));
  if (otherLabel !== null) {
    datasets.push({
      label: otherLabel,
      values: labels.map(() => null),
      raw: labels.map(() => null),
      colour: OTHER,
    });
  }
  return datasets;
}

/** Where each row's value goes: which position on the axis, and which dataset holds it. */
interface Fill {
  readonly result: TableResult;
  readonly x: number;
  readonly seriesAt: number;
  readonly yAt: number;
  readonly type: string;
  readonly labels: readonly string[];
  readonly kept: readonly string[];
}

/** A named series takes the position AND the readable figure behind it. */
function writeNamed(dataset: Dataset, at: number, cell: Cell, type: string): void {
  dataset.values[at] = plotValue(cell, type);
  dataset.raw[at] = rawOf(cell);
}

/**
 * The fold takes a sum of positions only.
 *
 * Its `raw` stays null on purpose: a sum of floats is not a figure anybody may read, and
 * printing one in a tooltip would be exactly the invisible wrongness rule 2 exists to
 * prevent. A null contributes nothing rather than counting as a zero.
 */
function addFolded(dataset: Dataset, at: number, cell: Cell, type: string): void {
  const value = plotValue(cell, type);
  if (value !== null) {
    dataset.values[at] = (dataset.values[at] ?? 0) + value;
  }
}

/** Write every row into the dataset its series names, or into the fold. */
function fillSeries(datasets: Dataset[], fill: Fill): void {
  const { result, x, seriesAt, yAt, type, labels, kept } = fill;
  for (const row of result.rows) {
    const at = labels.indexOf(labelOf(x < 0 ? null : (row[x] ?? null)));
    const ki = kept.indexOf(labelOf(row[seriesAt] ?? null));
    const dataset = datasets[ki >= 0 ? ki : datasets.length - 1];
    if (dataset === undefined) {
      continue;
    }
    if (ki >= 0) {
      writeNamed(dataset, at, row[yAt] ?? null, type);
    } else {
      addFolded(dataset, at, row[yAt] ?? null, type);
    }
  }
}

function bySeries(request: SeriesRequest): Series {
  const { result, x, seriesAt, yName, otherLabel } = request;
  const yAt = index(result, yName);
  const type = typeAt(result, yAt);
  const { labels, names } = axesOf(result, x, seriesAt);
  const kept = names.slice(0, MAX_SERIES);
  const datasets = emptySeries(labels, kept, names.length > MAX_SERIES ? otherLabel : null);

  fillSeries(datasets, { result, x, seriesAt, yAt, type, labels, kept });
  return { labels, datasets, x: result.columns[x]?.name ?? null, y: [yName] };
}

/** The result as series for `chart`. `otherLabel` is the reader's word for the fold. */
export function toSeries(result: TableResult, chart: ChartConfig, otherLabel: string): Series {
  const { x, y, series } = resolveColumns(result, chart);
  const xAt = index(result, x);
  const [firstY] = y;
  if (series !== null && firstY !== undefined) {
    return bySeries({
      result,
      x: xAt,
      seriesAt: index(result, series),
      yName: firstY,
      otherLabel,
    });
  }
  return byColumns(result, xAt, y);
}
