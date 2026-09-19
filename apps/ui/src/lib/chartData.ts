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
function bySeries(
  result: TableResult,
  x: number,
  seriesAt: number,
  yName: string,
  otherLabel: string,
): Series {
  const yAt = index(result, yName);
  const type = typeAt(result, yAt);
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
  const kept = names.slice(0, MAX_SERIES);
  const folded = names.length > MAX_SERIES;
  const datasets: {
    label: string;
    values: (number | null)[];
    raw: (string | null)[];
    colour: string;
  }[] = kept.map((name, i) => ({
    label: name,
    values: labels.map(() => null),
    raw: labels.map(() => null),
    colour: colourFor(i),
  }));
  if (folded) {
    datasets.push({
      label: otherLabel,
      values: labels.map(() => null),
      raw: labels.map(() => null),
      colour: OTHER,
    });
  }
  for (const row of result.rows) {
    const li = labels.indexOf(labelOf(x < 0 ? null : (row[x] ?? null)));
    const name = labelOf(row[seriesAt] ?? null);
    const ki = kept.indexOf(name);
    const di = ki >= 0 ? ki : datasets.length - 1;
    const dataset = datasets[di];
    if (dataset === undefined) {
      continue;
    }
    const value = plotValue(row[yAt] ?? null, type);
    if (ki >= 0) {
      dataset.values[li] = value;
      dataset.raw[li] = rawOf(row[yAt] ?? null);
    } else if (value !== null) {
      dataset.values[li] = (dataset.values[li] ?? 0) + value;
    }
  }
  return { labels, datasets, x: result.columns[x]?.name ?? null, y: [yName] };
}

/** The result as series for `chart`. `otherLabel` is the reader's word for the fold. */
export function toSeries(result: TableResult, chart: ChartConfig, otherLabel: string): Series {
  const { x, y, series } = resolveColumns(result, chart);
  const xAt = index(result, x);
  const [firstY] = y;
  if (series !== null && firstY !== undefined) {
    return bySeries(result, xAt, index(result, series), firstY, otherLabel);
  }
  return byColumns(result, xAt, y);
}
