/**
 * How a question is drawn: the chart's type, which column labels, which are plotted, which
 * splits the series, and the one bound a gauge or a progress bar needs.
 *
 * Every choice writes the draft's chart config in the store; the frame beside it redraws.
 * The columns offered are the result's own, typed by Postgres, so a column offered as a
 * value is one a chart can plot.
 */

import { CHART_TYPES, type ChartConfig, type ChartType } from "@undercroft/contracts/bi";
import { useTranslation } from "react-i18next";

import { isNumericType } from "@/lib/plot.ts";
import { useId } from "react";

const TYPE_KEY = {
  table: "chart.table",
  number: "chart.number",
  bar: "chart.bar",
  line: "chart.line",
  area: "chart.area",
  pie: "chart.pie",
  doughnut: "chart.doughnut",
  scatter: "chart.scatter",
  bubble: "chart.bubble",
  radar: "chart.radar",
  combo: "chart.combo",
  funnel: "chart.funnel",
  gauge: "chart.gauge",
  progress: "chart.progress",
  pivot: "chart.pivot",
  map: "chart.map",
} as const;

const NONE = "";
/** Types that take a maximum: the reading is a share of it. */
const BOUNDED: ReadonlySet<ChartType> = new Set<ChartType>(["gauge", "progress"]);

export function ChartOptions({
  columns,
  chart,
  onChange,
}: {
  columns: readonly { name: string; type: string }[];
  chart: ChartConfig;
  onChange: (chart: ChartConfig) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const chartMaxId = useId();
  const chartRegionId = useId();
  const chartSeriesId = useId();
  const chartTypeId = useId();
  const chartXAxisId = useId();
  const numeric = columns.filter((c) => isNumericType(c.type));
  const { max } = chart.options;

  return (
    <div className="stack stack--tight">
      <div className="row">
        <div className="field">
          <label className="label" htmlFor={chartTypeId}>
            {t("chart.typeLabel")}
          </label>
          <select
            className="input input--select"
            id={chartTypeId}
            value={chart.type}
            onChange={(event): void => {
              const chosen = event.currentTarget.value;
              const type = CHART_TYPES.find((candidate) => candidate === chosen);
              if (type !== undefined) {
                onChange({ ...chart, type });
              }
            }}
          >
            {CHART_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(TYPE_KEY[type])}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor={chartXAxisId}>
            {t("chart.xLabel")}
          </label>
          <select
            className="input input--select"
            id={chartXAxisId}
            value={chart.x ?? NONE}
            onChange={(event): void => {
              const x = event.currentTarget.value;
              const { x: _dropped, ...rest } = chart;
              onChange(x === NONE ? rest : { ...rest, x });
            }}
          >
            <option value={NONE}>{t("chart.none")}</option>
            {columns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor={chartSeriesId}>
            {t("chart.seriesLabel")}
          </label>
          <select
            className="input input--select"
            id={chartSeriesId}
            value={chart.series ?? NONE}
            onChange={(event): void => {
              const series = event.currentTarget.value;
              const { series: _dropped, ...rest } = chart;
              onChange(series === NONE ? rest : { ...rest, series });
            }}
          >
            <option value={NONE}>{t("chart.none")}</option>
            {columns
              .filter((c) => !isNumericType(c.type))
              .map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
          </select>
        </div>
        {chart.type === "map" ? (
          <div className="field">
            <label className="label" htmlFor={chartRegionId}>
              {t("chart.regionLabel")}
            </label>
            <select
              className="input input--select"
              id={chartRegionId}
              value={chart.options.region === "world" ? "world" : "vn"}
              onChange={(event): void => {
                onChange({
                  ...chart,
                  options: { ...chart.options, region: event.currentTarget.value },
                });
              }}
            >
              <option value="vn">{t("chart.regionVn")}</option>
              <option value="world">{t("chart.regionWorld")}</option>
            </select>
          </div>
        ) : null}
        {BOUNDED.has(chart.type) ? (
          <div className="field">
            <label className="label" htmlFor={chartMaxId}>
              {t("chart.maxLabel")}
            </label>
            <input
              className="input"
              id={chartMaxId}
              min={1}
              type="number"
              value={typeof max === "number" ? max : ""}
              onChange={(event): void => {
                // parseInt, not Number(): a bound on a dial, not an amount.
                const parsed = Number.parseInt(event.currentTarget.value, 10);
                const { max: _dropped, ...options } = chart.options;
                onChange({
                  ...chart,
                  options:
                    Number.isFinite(parsed) && parsed > 0 ? { ...options, max: parsed } : options,
                });
              }}
            />
          </div>
        ) : null}
      </div>

      {numeric.length === 0 ? null : (
        <fieldset className="index">
          <legend className="label index__legend">{t("chart.yLabel")}</legend>
          <div className="index__cols">
            {numeric.map((column) => (
              <label key={column.name} className="punch">
                <input
                  type="checkbox"
                  checked={chart.y.includes(column.name)}
                  onChange={(event): void => {
                    onChange({
                      ...chart,
                      y: event.currentTarget.checked
                        ? [...chart.y, column.name]
                        : chart.y.filter((name) => name !== column.name),
                    });
                  }}
                />
                <span className="punch__box" />
                <span>{column.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
