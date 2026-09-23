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
  const numeric = columns.filter((c) => isNumericType(c.type));

  return (
    <div className="stack stack--tight">
      {/* Every child here renders a `.field`, one component deep -- see `TypeSelect`
          below. The class is written out because the markup should say so; the
          `:has(> .field)` net in index.css is what would carry it if it were not. */}
      <div className="row row--field">
        <TypeSelect
          type={chart.type}
          onPick={(type): void => {
            onChange({ ...chart, type });
          }}
        />
        <ColumnSelect
          label={t("chart.xLabel")}
          value={chart.x ?? NONE}
          columns={columns}
          onPick={(x): void => {
            const { x: _dropped, ...rest } = chart;
            onChange(x === NONE ? rest : { ...rest, x });
          }}
        />
        <ColumnSelect
          label={t("chart.seriesLabel")}
          value={chart.series ?? NONE}
          columns={columns.filter((c) => !isNumericType(c.type))}
          onPick={(series): void => {
            const { series: _dropped, ...rest } = chart;
            onChange(series === NONE ? rest : { ...rest, series });
          }}
        />
        {chart.type === "map" ? <RegionSelect chart={chart} onChange={onChange} /> : null}
        {BOUNDED.has(chart.type) ? <MaxField chart={chart} onChange={onChange} /> : null}
      </div>

      {numeric.length === 0 ? null : (
        <ValueColumns chart={chart} numeric={numeric} onChange={onChange} />
      )}
    </div>
  );
}

/** Which of the sixteen drawings. The catalogue names them; `CHART_TYPES` orders them. */
function TypeSelect({
  type,
  onPick,
}: {
  type: ChartType;
  onPick: (type: ChartType) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const chartTypeId = useId();

  return (
    <div className="field">
      <label className="label" htmlFor={chartTypeId}>
        {t("chart.typeLabel")}
      </label>
      <select
        className="input input--select"
        id={chartTypeId}
        value={type}
        onChange={(event): void => {
          const chosen = event.currentTarget.value;
          const picked = CHART_TYPES.find((candidate) => candidate === chosen);
          if (picked !== undefined) {
            onPick(picked);
          }
        }}
      >
        {CHART_TYPES.map((candidate) => (
          <option key={candidate} value={candidate}>
            {t(TYPE_KEY[candidate])}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * One "which column" choice, offered from the result's own columns.
 *
 * Both the axis and the series are this select with a different label and a different
 * shortlist -- the caller filters, because which columns may answer is the caller's question.
 */
function ColumnSelect({
  label,
  value,
  columns,
  onPick,
}: {
  label: string;
  value: string;
  columns: readonly { name: string }[];
  onPick: (name: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const selectId = useId();

  return (
    <div className="field">
      <label className="label" htmlFor={selectId}>
        {label}
      </label>
      <select
        className="input input--select"
        id={selectId}
        value={value}
        onChange={(event): void => {
          onPick(event.currentTarget.value);
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
  );
}

/** Which map a map is drawn on. Only a map asks. */
function RegionSelect({
  chart,
  onChange,
}: {
  chart: ChartConfig;
  onChange: (chart: ChartConfig) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const chartRegionId = useId();

  return (
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
  );
}

/** The bound a gauge or a progress bar reads its share against. */
function MaxField({
  chart,
  onChange,
}: {
  chart: ChartConfig;
  onChange: (chart: ChartConfig) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const chartMaxId = useId();
  const { max } = chart.options;

  return (
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
            options: Number.isFinite(parsed) && parsed > 0 ? { ...options, max: parsed } : options,
          });
        }}
      />
    </div>
  );
}

/** Which columns are plotted. Only the numeric ones are offered, so a pick can be drawn. */
function ValueColumns({
  chart,
  numeric,
  onChange,
}: {
  chart: ChartConfig;
  numeric: readonly { name: string }[];
  onChange: (chart: ChartConfig) => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
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
  );
}
