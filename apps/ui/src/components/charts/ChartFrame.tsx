/**
 * A question drawn: every chart type the Reports division offers, on Chart.js, in one
 * frame -- loaded only when a result is on screen, so the charting library never rides in
 * the bundle an operator downloads to read a schedule.
 *
 * This file is the frame and the dispatch. The drawings themselves are in `plots.tsx` and
 * `readings.tsx`; what they all share -- the registration, the ink, the tooltip that reads
 * `raw[]` rather than the float under the cursor -- is in `chrome.ts`, with the two rules
 * that hold across every type here written out.
 *
 * The three types that are not a Chart.js drawing at all stay here: a table is the result
 * table, a pivot is a table this file builds, and a map is its own lazy chunk.
 */

import type { ChartConfig, ChartType } from "@undercroft/contracts/bi";
import type { Locale } from "@undercroft/core/locale";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

import type { TableResult } from "@/api/types.ts";
import { figure, plotOptions, type PlotOptions } from "@/components/charts/chrome.ts";
import {
  BarPlot,
  BubblePlot,
  ComboPlot,
  LinePlot,
  RadarPlot,
  ScatterPlot,
  SlicePlot,
} from "@/components/charts/plots.tsx";
import { FunnelPlot, GaugePlot, KpiTile, ProgressPlot } from "@/components/charts/readings.tsx";
import { ResultTable } from "@/components/ResultTable.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { resolveColumns, type Series, toSeries } from "@/lib/chartData.ts";
import { pivot } from "@/lib/pivot.ts";
import { isNumericType } from "@/lib/plot.ts";

// The geo plugin and the projection maths ride only with a map.
const GeoChart = lazy(() =>
  import("@/components/charts/GeoChart.tsx").then((module) => ({ default: module.GeoChart })),
);

/** The types that reach a Chart.js drawing. The four handled before it are not here. */
type PlottedType = Exclude<ChartType, "table" | "pivot" | "map" | "number">;

export function ChartFrame({
  result,
  chart,
  locale,
}: {
  result: TableResult;
  chart: ChartConfig;
  locale: Locale;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (chart.type === "table") {
    return <ResultTable result={result} locale={locale} />;
  }
  if (chart.type === "pivot") {
    return <PivotTable result={result} chart={chart} />;
  }
  if (chart.type === "map") {
    return (
      <Suspense fallback={<Skeleton rows={6} />}>
        <GeoChart result={result} chart={chart} />
      </Suspense>
    );
  }

  const series = toSeries(result, chart, t("chart.other"));
  const numericColumns = result.columns.filter((c) => isNumericType(c.type)).length;
  if (series.datasets.length === 0 || (numericColumns === 0 && chart.type !== "number")) {
    return <p className="note">{t("chart.noNumeric")}</p>;
  }
  if (chart.type === "number") {
    return <KpiTile series={series} />;
  }

  return (
    <Plot
      type={chart.type}
      result={result}
      chart={chart}
      series={series}
      options={plotOptions(series, locale)}
    />
  );
}

/**
 * Which drawing, for a type that reaches one.
 *
 * `type` arrives narrowed so the default branch can assert the union is covered: adding a
 * chart type to the contract stops compiling HERE rather than rendering nothing.
 */
function Plot({
  type,
  result,
  chart,
  series,
  options,
}: {
  type: PlottedType;
  result: TableResult;
  chart: ChartConfig;
  series: Series;
  options: PlotOptions;
}): React.JSX.Element {
  switch (type) {
    case "bar":
      return <BarPlot series={series} options={options} />;
    case "line":
      return <LinePlot series={series} options={options} fill={false} />;
    case "area":
      return <LinePlot series={series} options={options} fill={true} />;
    case "pie":
      return <SlicePlot series={series} options={options} hollow={false} />;
    case "doughnut":
      return <SlicePlot series={series} options={options} hollow={true} />;
    case "radar":
      return <RadarPlot series={series} options={options} />;
    case "scatter":
      return <ScatterPlot result={result} chart={chart} series={series} options={options} />;
    case "bubble":
      return <BubblePlot result={result} chart={chart} series={series} options={options} />;
    case "combo":
      return <ComboPlot series={series} options={options} />;
    case "funnel":
      return <FunnelPlot series={series} options={options} />;
    case "gauge":
      return <GaugePlot series={series} chart={chart} options={options} />;
    case "progress":
      return <ProgressPlot series={series} chart={chart} options={options} />;
    default: {
      const exhaustive: never = type;
      return <p className="note">{String(exhaustive)}</p>;
    }
  }
}

/**
 * The result crossed: one row per value of the x column, one column per value of the series
 * column, and a total down each edge.
 *
 * A table rather than a drawing, because what a pivot is for is reading the figures -- so
 * every cell is `raw` through `figure`, never a float.
 */
function PivotTable({
  result,
  chart,
}: {
  result: TableResult;
  chart: ChartConfig;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { x, y, series } = resolveColumns(result, chart);
  const [value] = y;
  if (x === null || value === undefined) {
    return <p className="note">{t("chart.pivotNeeds")}</p>;
  }
  const table = pivot(result, { rowsBy: x, colsBy: series, value }, t("chart.total"));
  return (
    <div className="result">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{x}</th>
            {table.columns.map((column) => (
              <th key={column} scope="col" className="num">
                {column}
              </th>
            ))}
            <th scope="col" className="num">
              {t("chart.total")}
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.key}>
              <td className="datum">{row.key}</td>
              {row.cells.map((cell, i) => (
                <td key={i} className="num datum">
                  {figure(cell)}
                </td>
              ))}
              <td className="num datum">{figure(row.total)}</td>
            </tr>
          ))}
          <tr>
            <td className="datum">{t("chart.total")}</td>
            {table.totals.map((cell, i) => (
              <td key={i} className="num datum">
                {figure(cell)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
