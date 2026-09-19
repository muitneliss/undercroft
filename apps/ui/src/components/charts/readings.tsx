/**
 * The drawings that show ONE reading: a KPI tile, a gauge, a progress bar, and the funnel
 * that is a series of readings against the first.
 *
 * All four print the figure from `raw[]` -- the original digits -- while positioning the
 * needle, the bar or the trapezoid from `values[]`. A gauge whose reading came off its own
 * float would be a number nobody could reconcile with the table beside it.
 */

import type { ChartConfig } from "@undercroft/contracts/bi";
import { Bar, Chart, Doughnut } from "react-chartjs-2";
import { useTranslation } from "react-i18next";

import { figure, type PlotOptions, TOKENS } from "@/components/charts/chrome.ts";
import type { Series } from "@/lib/chartData.ts";
import { needlePlugin } from "@/lib/gaugeNeedle.ts";
import { colourFor } from "@/lib/plotPalette.ts";

/** The first reading: a gauge's, a progress bar's, a KPI tile's. */
function firstReading(series: Series): { value: number | null; raw: string | null; label: string } {
  const [first] = series.datasets;
  return {
    value: first?.values[0] ?? null,
    raw: first?.raw[0] ?? null,
    label: first?.label ?? "",
  };
}

/**
 * What a gauge or a progress bar reads its share against.
 *
 * The configured maximum wins; otherwise the largest value plotted. A hundred is the last
 * resort, never a zero -- a bar divided by zero is a bar that is always full.
 */
function maxOf(series: Series, chart: ChartConfig): number {
  const configured = chart.options.max;
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  let max = 0;
  for (const dataset of series.datasets) {
    for (const value of dataset.values) {
      if (value !== null && value > max) {
        max = value;
      }
    }
  }
  return max > 0 ? max : 100;
}

/** One figure, large, with what it is beneath it. A missing reading says so; it is not a 0. */
export function KpiTile({ series }: { series: Series }): React.JSX.Element {
  const { t } = useTranslation();
  const reading = firstReading(series);
  return (
    <div className="tile">
      <span className="tile__figure">
        {reading.raw === null ? t("chart.noValue") : figure(reading.raw)}
      </span>
      <span className="label">{reading.label}</span>
    </div>
  );
}

/** A half-doughnut with a needle, and the reading printed under it. */
export function GaugePlot({
  series,
  chart,
  options,
}: {
  series: Series;
  chart: ChartConfig;
  options: PlotOptions;
}): React.JSX.Element {
  const reading = firstReading(series);
  const max = maxOf(series, chart);
  const value = reading.value ?? 0;

  return (
    <div className="stack stack--tight">
      <div className="plot plot--gauge">
        <Doughnut
          data={{
            datasets: [
              {
                data: [value, Math.max(0, max - value)],
                backgroundColor: [colourFor(0), TOKENS.rule],
                borderWidth: 0,
                circumference: 180,
                rotation: 270,
              },
            ],
          }}
          options={{
            ...options.base,
            cutout: "70%",
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
          }}
          plugins={[needlePlugin(max === 0 ? 0 : value / max, TOKENS.ink)]}
        />
      </div>
      <KpiTile series={series} />
    </div>
  );
}

/** One horizontal bar against its bound, and the reading printed under it. */
export function ProgressPlot({
  series,
  chart,
  options,
}: {
  series: Series;
  chart: ChartConfig;
  options: PlotOptions;
}): React.JSX.Element {
  const reading = firstReading(series);
  const max = maxOf(series, chart);

  return (
    <div className="stack stack--tight">
      <div className="plot plot--progress">
        <Bar
          data={{
            labels: [reading.label],
            datasets: [
              { label: reading.label, data: [reading.value], backgroundColor: colourFor(0) },
            ],
          }}
          options={{
            ...options.base,
            indexAxis: "y",
            plugins: { legend: { display: false }, tooltip: options.plugins.tooltip },
            scales: {
              x: { min: 0, max, grid: { color: TOKENS.rule } },
              y: { grid: { display: false } },
            },
          }}
        />
      </div>
      <KpiTile series={series} />
    </div>
  );
}

/** Stages narrowing, top to bottom. A null stage is drawn as nothing rather than skipped. */
export function FunnelPlot({
  series,
  options,
}: {
  series: Series;
  options: PlotOptions;
}): React.JSX.Element {
  const [first] = series.datasets;

  return (
    <div className="plot">
      <Chart
        type="funnel"
        data={{
          labels: series.labels,
          datasets: [
            {
              label: first?.label ?? "",
              data: (first?.values ?? []).map((v) => v ?? 0),
              backgroundColor: series.labels.map((_l, i) => colourFor(i)),
            },
          ],
        }}
        options={{
          ...options.base,
          indexAxis: "y",
          plugins: { legend: { display: false }, tooltip: options.plugins.tooltip },
        }}
      />
    </div>
  );
}
