/**
 * The plots drawn on a pair of axes, or on a circle: bar, line, area, combo, pie, doughnut,
 * radar, scatter and bubble.
 *
 * One component per drawing, each taking the series and the shared options rather than
 * building its own -- so the legend, the tooltip and the axes are the same across all nine,
 * which is what makes two charts on one dashboard read as one interface.
 *
 * Every data builder positions the canvas from `values[]`; not one of them formats a figure.
 * That is `chrome.ts`'s job, through `raw[]`.
 */

import type { ChartConfig } from "@undercroft/contracts/bi";
import type { ChartData } from "chart.js";
import { Bar, Bubble, Chart, Doughnut, Line, Pie, Radar, Scatter } from "react-chartjs-2";

import type { TableResult } from "@/api/types.ts";
import { type PlotOptions, TOKENS } from "@/components/charts/chrome.ts";
import { resolveColumns, type Series } from "@/lib/chartData.ts";
import { plotValue } from "@/lib/plot.ts";
import { colourFor } from "@/lib/plotPalette.ts";

function barData(series: Series): ChartData<"bar", (number | null)[], string> {
  return {
    labels: series.labels,
    datasets: series.datasets.map((d) => ({
      label: d.label,
      data: d.values,
      backgroundColor: d.colour,
      borderColor: d.colour,
    })),
  };
}

function lineData(series: Series, fill: boolean): ChartData<"line", (number | null)[], string> {
  return {
    labels: series.labels,
    datasets: series.datasets.map((d) => ({
      label: d.label,
      data: d.values,
      borderColor: d.colour,
      backgroundColor: fill ? `${d.colour}33` : d.colour,
      fill,
      tension: 0,
      spanGaps: false,
      pointRadius: 2,
    })),
  };
}

/** A pie's or a doughnut's data: one slice per label of the first dataset. */
interface SliceData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor: string[];
    borderColor: string;
    borderWidth: number;
  }[];
}

function sliceData(series: Series): SliceData {
  const [first] = series.datasets;
  return {
    labels: series.labels,
    datasets: [
      {
        label: first?.label ?? "",
        data: (first?.values ?? []).map((v) => v ?? 0),
        backgroundColor: series.labels.map((_l, i) => colourFor(i)),
        borderColor: "#fbf8f0",
        borderWidth: 1,
      },
    ],
  };
}

function radarData(series: Series): ChartData<"radar", (number | null)[], string> {
  return {
    labels: series.labels,
    datasets: series.datasets.map((d) => ({
      label: d.label,
      data: d.values,
      borderColor: d.colour,
      backgroundColor: `${d.colour}33`,
      pointRadius: 2,
    })),
  };
}

/** Which column each coordinate of one dataset is read from, and how each is typed. */
interface PointColumns {
  readonly xAt: number;
  readonly xType: string;
  readonly yAt: number;
  readonly yType: string;
  readonly rAt: number;
  readonly rType: string;
}

/**
 * One dataset's points. A row missing either coordinate is DROPPED, never zeroed: a point at
 * the origin is a claim about the data, and a gap is the absence of one.
 */
function columnPoints(
  result: TableResult,
  at: PointColumns,
): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number }[] = [];
  for (const row of result.rows) {
    const px = plotValue(row[at.xAt] ?? null, at.xType);
    const py = plotValue(row[at.yAt] ?? null, at.yType);
    if (px === null || py === null) {
      continue;
    }
    const pr = at.rAt < 0 ? null : plotValue(row[at.rAt] ?? null, at.rType);
    out.push({ x: px, y: py, r: pr === null ? 4 : Math.max(2, Math.sqrt(Math.abs(pr))) });
  }
  return out;
}

/** Points with both coordinates: the x column plotted too, one dataset per y column. */
function points(result: TableResult, chart: ChartConfig): { x: number; y: number; r: number }[][] {
  const { x, y } = resolveColumns(result, chart);
  const xAt = result.columns.findIndex((c) => c.name === x);
  const xType = result.columns[xAt]?.type ?? "";
  return y.map((name, i) => {
    const yAt = result.columns.findIndex((c) => c.name === name);
    // The NEXT y column, when there is one, is the bubble's radius.
    const rAt = result.columns.findIndex((c) => c.name === y[i + 1]);
    return columnPoints(result, {
      xAt,
      xType,
      yAt,
      yType: result.columns[yAt]?.type ?? "",
      rAt,
      rType: result.columns[rAt]?.type ?? "",
    });
  });
}

export function BarPlot({
  series,
  options,
}: {
  series: Series;
  options: PlotOptions;
}): React.JSX.Element {
  return (
    <div className="plot">
      <Bar
        data={barData(series)}
        options={{ ...options.base, plugins: options.plugins, scales: options.scales }}
      />
    </div>
  );
}

/** A line, or the same line filled: an area is a line that says "of a whole". */
export function LinePlot({
  series,
  options,
  fill,
}: {
  series: Series;
  options: PlotOptions;
  fill: boolean;
}): React.JSX.Element {
  return (
    <div className="plot">
      <Line
        data={lineData(series, fill)}
        options={{ ...options.base, plugins: options.plugins, scales: options.scales }}
      />
    </div>
  );
}

/**
 * A pie or a doughnut.
 *
 * The legend is always shown, unlike the cartesian plots': a slice has no axis to be read
 * against, so the key IS the labelling.
 */
export function SlicePlot({
  series,
  options,
  hollow,
}: {
  series: Series;
  options: PlotOptions;
  hollow: boolean;
}): React.JSX.Element {
  const Drawing = hollow ? Doughnut : Pie;
  return (
    <div className="plot">
      <Drawing
        data={sliceData(series)}
        options={{
          ...options.base,
          plugins: { ...options.plugins, legend: { display: true, position: "bottom" } },
        }}
      />
    </div>
  );
}

export function RadarPlot({
  series,
  options,
}: {
  series: Series;
  options: PlotOptions;
}): React.JSX.Element {
  return (
    <div className="plot">
      <Radar data={radarData(series)} options={{ ...options.base, plugins: options.plugins }} />
    </div>
  );
}

/** Both coordinates plotted: one dataset per y column, gaps dropped rather than zeroed. */
export function ScatterPlot({
  result,
  chart,
  series,
  options,
}: {
  result: TableResult;
  chart: ChartConfig;
  series: Series;
  options: PlotOptions;
}): React.JSX.Element {
  const sets = points(result, chart);
  return (
    <div className="plot">
      <Scatter
        data={{
          datasets: sets.map((data, i) => ({
            label: series.y[i] ?? "",
            data: data.map((p) => ({ x: p.x, y: p.y })),
            backgroundColor: colourFor(i),
          })),
        }}
        options={{
          ...options.base,
          plugins: { legend: options.plugins.legend },
          scales: { x: { grid: { color: TOKENS.rule } }, y: options.scales.y },
        }}
      />
    </div>
  );
}

/** A scatter whose third column is the radius. One dataset only: two would not be readable. */
export function BubblePlot({
  result,
  chart,
  series,
  options,
}: {
  result: TableResult;
  chart: ChartConfig;
  series: Series;
  options: PlotOptions;
}): React.JSX.Element {
  const [first] = points(result, chart);
  return (
    <div className="plot">
      <Bubble
        data={{
          datasets: [
            { label: series.y[0] ?? "", data: first ?? [], backgroundColor: `${colourFor(0)}99` },
          ],
        }}
        options={{
          ...options.base,
          plugins: { legend: { display: false } },
          scales: { x: { grid: { color: TOKENS.rule } }, y: options.scales.y },
        }}
      />
    </div>
  );
}

/** The first series as bars, the rest as lines: a total with its components over it. */
export function ComboPlot({
  series,
  options,
}: {
  series: Series;
  options: PlotOptions;
}): React.JSX.Element {
  const [bars, ...lines] = series.datasets;
  return (
    <div className="plot">
      <Chart<"bar" | "line">
        type="bar"
        data={{
          labels: series.labels,
          datasets: [
            ...(bars === undefined
              ? []
              : [
                  {
                    type: "bar" as const,
                    label: bars.label,
                    data: bars.values,
                    backgroundColor: bars.colour,
                  },
                ]),
            ...lines.map((d) => ({
              type: "line" as const,
              label: d.label,
              data: d.values,
              borderColor: d.colour,
              backgroundColor: d.colour,
              tension: 0,
              pointRadius: 2,
            })),
          ],
        }}
        options={{ ...options.base, plugins: options.plugins, scales: options.scales }}
      />
    </div>
  );
}
