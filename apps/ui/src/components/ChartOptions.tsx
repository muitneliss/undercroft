/**
 * How a question is drawn: the chart's type, which column labels, which are plotted, which
 * splits the series, and the one bound a gauge or a progress bar needs.
 *
 * Every choice writes the draft's chart config in the store; the frame beside it redraws.
 * The columns offered are the result's own, typed by Postgres, so a column offered as a
 * value is one a chart can plot.
 */

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/correctness/useUniqueElementIds: Static ids on a single-instance form: the panel renders once per question, and the ids are what its <label>s point at.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks whose inferred type is a React shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- React's event handlers -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/performance/noJsxPropsBind: Inline handlers on the panel's controls. The re-render the rule is about needs a memoised child to bite; these props land on plain DOM elements.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { CHART_TYPES, type ChartConfig, type ChartType } from "@undercroft/contracts/bi";
import { useTranslation } from "react-i18next";

import { isNumericType } from "@/lib/plot.ts";

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
  const { max } = chart.options;

  return (
    <div className="stack stack--tight">
      <div className="row">
        <div className="field">
          <label className="label" htmlFor="chart-type">
            {t("chart.typeLabel")}
          </label>
          <select
            className="input input--select"
            id="chart-type"
            value={chart.type}
            onChange={(event) => {
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
          <label className="label" htmlFor="chart-x">
            {t("chart.xLabel")}
          </label>
          <select
            className="input input--select"
            id="chart-x"
            value={chart.x ?? NONE}
            onChange={(event) => {
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
          <label className="label" htmlFor="chart-series">
            {t("chart.seriesLabel")}
          </label>
          <select
            className="input input--select"
            id="chart-series"
            value={chart.series ?? NONE}
            onChange={(event) => {
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
        {BOUNDED.has(chart.type) ? (
          <div className="field">
            <label className="label" htmlFor="chart-max">
              {t("chart.maxLabel")}
            </label>
            <input
              className="input"
              id="chart-max"
              min={1}
              type="number"
              value={typeof max === "number" ? max : ""}
              onChange={(event) => {
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
                  onChange={(event) => {
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
