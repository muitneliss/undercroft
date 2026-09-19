/**
 * A question drawn: every chart type the Reports division offers, on Chart.js, in one
 * frame -- loaded only when a result is on screen, so the charting library never rides in
 * the bundle an operator downloads to read a schedule.
 *
 * Two rules hold across every type here:
 *
 * - **Money never becomes a figure through a float.** The canvas is positioned from
 *   `values[]` (floats, made once in `lib/plot.ts`); every figure a reader can read -- a
 *   tooltip, a KPI tile, a gauge's reading, a pivot's cell -- comes from `raw[]` through
 *   `formatDecimal`, or from a `Big` sum. Axis ticks are scale positions, not ledger
 *   values, and go through `formatCount`.
 * - **Nothing animates.** Chart.js can only ease, and this interface's motion is stepped
 *   (ADR 0014); `animation: false` globally, and the frame inks in with `--pass` in CSS.
 *
 * Chart chrome reads the tokens off the document once, so the chart is set in the same
 * face and ink as the leaf it sits on.
 */

// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: The frame is one switch over sixteen chart types, each arm a few lines; splitting it by family would put the shape of one decision -- which type gets which drawing -- across several names.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/correctness/useQwikValidLexicalScope: Qwik-domain rule about what may cross a `$()` serialization boundary. There is no Qwik in this repo.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks whose inferred type is a Chart.js option shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Chart.js's tooltip and tick callbacks -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/performance/noJsxPropsBind: Data and option objects built per render for a chart of one result. The re-render the rule is about matters under a memoised list of hundreds.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noExcessiveLinesPerFile: One frame, one file: sixteen chart types over one series shape, and a reader checking that every type honours the two rules in the docstring wants them side by side rather than in sixteen files that agree by convention.
// biome-ignore-all lint/style/noContinue: Each `continue` here skips one item in a loop with a stated reason on the line above. Restructuring to avoid it means nesting the body in an `if`, which adds a level of indentation and says nothing new.
// biome-ignore-all lint/style/useNamingConvention: `ChartJS` is the name react-chartjs-2's own documentation gives the Chart.js class when both are in one file, to keep it apart from the `Chart` component; strictCase would have it `ChartJs`, which no reader of either library recognises.
// biome-ignore-all lint/style/noMagicNumbers: Chart geometry -- a half circle's degrees, a point's radius, a cutout's share -- is the number itself, read beside the option it sets.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noArrayIndexKey: A pivot cell has no identity but its position; the table is replaced whole on every run.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import type { ChartConfig } from "@undercroft/contracts/bi";
import type { Locale } from "@undercroft/core/locale";
import {
  ArcElement,
  BarController,
  BarElement,
  BubbleController,
  CategoryScale,
  Chart as ChartJS,
  type ChartData,
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
  type TooltipItem,
} from "chart.js";
import { FunnelController, TrapezoidElement } from "chartjs-chart-funnel";
import { Bar, Bubble, Chart, Doughnut, Line, Pie, Radar, Scatter } from "react-chartjs-2";
import { useTranslation } from "react-i18next";

import type { TableResult } from "@/api/types.ts";
import { ResultTable } from "@/components/ResultTable.tsx";
import { resolveColumns, type Series, toSeries } from "@/lib/chartData.ts";
import { needlePlugin } from "@/lib/gaugeNeedle.ts";
import { formatCount, formatDecimal, MISSING } from "@/lib/money.ts";
import { pivot } from "@/lib/pivot.ts";
import { isNumericType, plotValue } from "@/lib/plot.ts";
import { colourFor } from "@/lib/plotPalette.ts";

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

const TOKENS = applyTokens();

/** A readable figure for one cell: the original digits, grouped, or MISSING. */
function figure(raw: string | null): string {
  return raw === null ? MISSING : formatDecimal(raw);
}

/** The tooltip says the figure from `raw`, never the float under the cursor. */
function tooltipLabel(series: Series) {
  return (item: TooltipItem<"bar" | "line" | "pie" | "doughnut" | "radar" | "funnel">): string => {
    const raw = series.datasets[item.datasetIndex]?.raw[item.dataIndex] ?? null;
    const label = item.dataset.label ?? series.labels[item.dataIndex] ?? "";
    return `${label}: ${figure(raw)}`;
  };
}

function cartesianScales(locale: Locale) {
  return {
    y: {
      ticks: {
        callback: (value: string | number) =>
          typeof value === "number" ? formatCount(value, locale) : value,
      },
      grid: { color: TOKENS.rule },
    },
    x: { grid: { display: false } },
  };
}

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

/** Points with both coordinates: the x column plotted too, and gaps dropped. */
function points(result: TableResult, chart: ChartConfig): { x: number; y: number; r: number }[][] {
  const { x, y } = resolveColumns(result, chart);
  const xAt = result.columns.findIndex((c) => c.name === x);
  const xType = result.columns[xAt]?.type ?? "";
  return y.map((name, i) => {
    const yAt = result.columns.findIndex((c) => c.name === name);
    const rAt = result.columns.findIndex((c) => c.name === y[i + 1]);
    const yType = result.columns[yAt]?.type ?? "";
    const rType = result.columns[rAt]?.type ?? "";
    const out: { x: number; y: number; r: number }[] = [];
    for (const row of result.rows) {
      const px = plotValue(row[xAt] ?? null, xType);
      const py = plotValue(row[yAt] ?? null, yType);
      if (px === null || py === null) {
        continue;
      }
      const pr = rAt < 0 ? null : plotValue(row[rAt] ?? null, rType);
      out.push({ x: px, y: py, r: pr === null ? 4 : Math.max(2, Math.sqrt(Math.abs(pr))) });
    }
    return out;
  });
}

/** The first reading: a gauge's, a progress bar's, a KPI tile's. */
function firstReading(series: Series): { value: number | null; raw: string | null; label: string } {
  const [first] = series.datasets;
  return {
    value: first?.values[0] ?? null,
    raw: first?.raw[0] ?? null,
    label: first?.label ?? "",
  };
}

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

function KpiTile({ series }: { series: Series }): React.JSX.Element {
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
    return <p className="note">{t("chart.mapLater")}</p>;
  }

  const series = toSeries(result, chart, t("chart.other"));
  const numericColumns = result.columns.filter((c) => isNumericType(c.type)).length;
  if (series.datasets.length === 0 || (numericColumns === 0 && chart.type !== "number")) {
    return <p className="note">{t("chart.noNumeric")}</p>;
  }
  if (chart.type === "number") {
    return <KpiTile series={series} />;
  }

  const plugins = {
    legend: { display: series.datasets.length > 1, position: "bottom" as const },
    tooltip: { callbacks: { label: tooltipLabel(series) } },
  };
  const scales = cartesianScales(locale);
  const base = { responsive: true, maintainAspectRatio: false };

  switch (chart.type) {
    case "bar":
      return (
        <div className="plot">
          <Bar data={barData(series)} options={{ ...base, plugins, scales }} />
        </div>
      );
    case "line":
    case "area":
      return (
        <div className="plot">
          <Line
            data={lineData(series, chart.type === "area")}
            options={{ ...base, plugins, scales }}
          />
        </div>
      );
    case "pie":
      return (
        <div className="plot">
          <Pie
            data={sliceData(series)}
            options={{
              ...base,
              plugins: { ...plugins, legend: { display: true, position: "bottom" } },
            }}
          />
        </div>
      );
    case "doughnut":
      return (
        <div className="plot">
          <Doughnut
            data={sliceData(series)}
            options={{
              ...base,
              plugins: { ...plugins, legend: { display: true, position: "bottom" } },
            }}
          />
        </div>
      );
    case "radar":
      return (
        <div className="plot">
          <Radar data={radarData(series)} options={{ ...base, plugins }} />
        </div>
      );
    case "scatter": {
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
              ...base,
              plugins: { legend: plugins.legend },
              scales: { x: { grid: { color: TOKENS.rule } }, y: scales.y },
            }}
          />
        </div>
      );
    }
    case "bubble": {
      const [first] = points(result, chart);
      return (
        <div className="plot">
          <Bubble
            data={{
              datasets: [
                {
                  label: series.y[0] ?? "",
                  data: first ?? [],
                  backgroundColor: `${colourFor(0)}99`,
                },
              ],
            }}
            options={{
              ...base,
              plugins: { legend: { display: false } },
              scales: { x: { grid: { color: TOKENS.rule } }, y: scales.y },
            }}
          />
        </div>
      );
    }
    case "combo": {
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
            options={{ ...base, plugins, scales }}
          />
        </div>
      );
    }
    case "funnel": {
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
              ...base,
              indexAxis: "y",
              plugins: { legend: { display: false }, tooltip: plugins.tooltip },
            }}
          />
        </div>
      );
    }
    case "gauge": {
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
                ...base,
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
    case "progress": {
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
                ...base,
                indexAxis: "y",
                plugins: { legend: { display: false }, tooltip: plugins.tooltip },
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
    default: {
      const exhaustive: never = chart.type;
      return <p className="note">{String(exhaustive)}</p>;
    }
  }
}
