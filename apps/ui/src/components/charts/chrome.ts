/**
 * The chart chrome: what Chart.js is registered with, the ink it draws in, and the two
 * callbacks every plot in this directory shares.
 *
 * Two rules hold across every chart type, and they live here because they are properties of
 * the frame rather than of any one drawing:
 *
 * - **Money never becomes a figure through a float.** The canvas is positioned from
 *   `values[]` (floats, made once in `lib/plot.ts`); every figure a reader can read -- a
 *   tooltip, a KPI tile, a gauge's reading, a pivot's cell -- comes from `raw[]` through
 *   `formatDecimal`. Axis ticks are scale positions, not ledger values, and go through
 *   `formatCount`.
 * - **Nothing animates.** Chart.js can only ease, and this interface's motion is stepped
 *   (ADR 0014); `animation: false` globally, and the frame inks in with `--pass` in CSS.
 *
 * The tokens are read off the document ONCE, at module scope, so the chart is set in the same
 * face and ink as the leaf it sits on without a read per render.
 */

import type { Locale } from "@undercroft/core/locale";
import {
  ArcElement,
  BarController,
  BarElement,
  BubbleController,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  RadarController,
  RadialLinearScale,
  ScatterController,
  Tooltip,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { FunnelController, TrapezoidElement } from "chartjs-chart-funnel";

import type { Series } from "@/lib/chartData.ts";
import { formatCount, formatDecimal, MISSING } from "@/lib/money.ts";

ChartJS.register(
  ArcElement,
  BarController,
  BarElement,
  BubbleController,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  RadarController,
  RadialLinearScale,
  ScatterController,
  Tooltip,
  FunnelController,
  TrapezoidElement,
);

/** The tokens the leaf is set in, read once. Chart.js can only ease, so it does not move. */
function applyTokens(): { ink: string; rule: string } {
  const style = getComputedStyle(document.documentElement);
  function token(name: string, fallback: string): string {
    const value = style.getPropertyValue(name).trim();
    return value === "" ? fallback : value;
  }
  const ink = token("--ink", "#16150f");
  const rule = token("--rule", "rgba(22, 21, 15, 0.16)");
  ChartJS.defaults.animation = false;
  ChartJS.defaults.font.family = token("--face-mono", "monospace");
  ChartJS.defaults.font.size = 11;
  ChartJS.defaults.color = token("--ink-2", "#56513f");
  ChartJS.defaults.borderColor = rule;
  return { ink, rule };
}

export const TOKENS = applyTokens();

/** A readable figure for one cell: the original digits, grouped, or MISSING. */
export function figure(raw: string | null): string {
  return raw === null ? MISSING : formatDecimal(raw);
}

/** The tooltip says the figure from `raw`, never the float under the cursor. */
export function tooltipLabel(series: Series) {
  return (item: TooltipItem<"bar" | "line" | "pie" | "doughnut" | "radar" | "funnel">): string => {
    const raw = series.datasets[item.datasetIndex]?.raw[item.dataIndex] ?? null;
    const label = item.dataset.label ?? series.labels[item.dataIndex] ?? "";
    return `${label}: ${figure(raw)}`;
  };
}

function cartesianScales(locale: Locale): NonNullable<ChartOptions<"line">["scales"]> {
  return {
    y: {
      ticks: {
        callback: (value: string | number): string =>
          typeof value === "number" ? formatCount(value, locale) : String(value),
      },
      grid: { color: TOKENS.rule },
    },
    x: { grid: { display: false } },
  };
}

/**
 * The options every plot shares: the responsive frame, the legend, the tooltip, the axes.
 *
 * Built once per render and handed to whichever plot is drawn, so a change to how this
 * interface reads a chart is one edit rather than twelve.
 */
export interface PlotOptions {
  readonly base: { readonly responsive: boolean; readonly maintainAspectRatio: boolean };
  readonly plugins: {
    readonly legend: { readonly display: boolean; readonly position: "bottom" };
    readonly tooltip: { readonly callbacks: { readonly label: ReturnType<typeof tooltipLabel> } };
  };
  readonly scales: NonNullable<ChartOptions<"line">["scales"]>;
}

export function plotOptions(series: Series, locale: Locale): PlotOptions {
  return {
    base: { responsive: true, maintainAspectRatio: false },
    plugins: {
      legend: { display: series.datasets.length > 1, position: "bottom" as const },
      tooltip: { callbacks: { label: tooltipLabel(series) } },
    },
    scales: cartesianScales(locale),
  };
}
