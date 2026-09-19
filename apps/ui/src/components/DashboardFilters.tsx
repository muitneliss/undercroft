/**
 * The shared filters at the top of a dashboard, as a form that writes the URL.
 *
 * Nothing here holds a value: the search string does, under `p.<name>` as a question's own
 * parameters do, so the tiles beneath read the same values a colleague gets by opening the
 * link. A date range offers the four presets an operator reaches for as plates that apply
 * at once, and a from/to pair for anything else; text and number are one input each.
 * Apply writes every filter's value in one step; Clear removes them all.
 */

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks whose inferred type is a React shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- React's event handlers -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/performance/noJsxPropsBind: Inline handlers on the form's controls. The re-render the rule is about needs a memoised child to bite; these props land on plain DOM elements.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import type { DashboardFilter } from "@undercroft/contracts/bi";
import { useTranslation } from "react-i18next";

import {
  DATE_PRESETS,
  type DatePreset,
  paramsOfAll,
  presetRange,
  rangeParams,
} from "@/lib/dashboardFilters.ts";
import { PARAM_PREFIX, withParam } from "@/lib/params.ts";

const PRESET_KEY = {
  last7: "dashboard.last7",
  last30: "dashboard.last30",
  thisMonth: "dashboard.thisMonth",
  thisYear: "dashboard.thisYear",
} as const;

function heldValue(search: URLSearchParams, name: string): string {
  return search.get(`${PARAM_PREFIX}${name}`) ?? "";
}

function DateRange({
  filter,
  search,
  onApply,
}: {
  filter: DashboardFilter;
  search: URLSearchParams;
  onApply: (next: URLSearchParams) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { from, to } = rangeParams(filter.name);
  return (
    <fieldset className="stack stack--tight">
      <legend className="label">{filter.label}</legend>
      <div className="filters__presets">
        {DATE_PRESETS.map((preset: DatePreset) => (
          <button
            key={preset}
            className="plate plate--small"
            type="button"
            onClick={() => {
              const range = presetRange(preset);
              onApply(withParam(withParam(search, from, range.from), to, range.to));
            }}
          >
            {t(PRESET_KEY[preset])}
          </button>
        ))}
      </div>
      <div className="row">
        <div className="field">
          <label className="label" htmlFor={`f-${from}`}>
            {t("dashboard.from")}
          </label>
          <input
            className="input"
            defaultValue={heldValue(search, from)}
            id={`f-${from}`}
            key={`${from}=${heldValue(search, from)}`}
            name={from}
            type="date"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={`f-${to}`}>
            {t("dashboard.to")}
          </label>
          <input
            className="input"
            defaultValue={heldValue(search, to)}
            id={`f-${to}`}
            key={`${to}=${heldValue(search, to)}`}
            name={to}
            type="date"
          />
        </div>
      </div>
    </fieldset>
  );
}

export function DashboardFilters({
  filters,
  search,
  onApply,
}: {
  filters: readonly DashboardFilter[];
  search: URLSearchParams;
  onApply: (next: URLSearchParams) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const names = paramsOfAll(filters);

  return (
    <form
      className="stack stack--tight"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        let next = search;
        for (const name of names) {
          next = withParam(next, name, String(data.get(name) ?? "").trim());
        }
        onApply(next);
      }}
    >
      <div className="filters">
        {filters.map((filter) =>
          filter.kind === "date_range" ? (
            <DateRange key={filter.name} filter={filter} search={search} onApply={onApply} />
          ) : (
            <div key={filter.name} className="field">
              <label className="label" htmlFor={`f-${filter.name}`}>
                {filter.label}
              </label>
              <input
                autoComplete="off"
                className="input"
                defaultValue={heldValue(search, filter.name)}
                id={`f-${filter.name}`}
                inputMode={filter.kind === "number" ? "decimal" : "text"}
                key={`${filter.name}=${heldValue(search, filter.name)}`}
                name={filter.name}
                type="text"
              />
            </div>
          ),
        )}
      </div>
      <div className="row">
        <button className="plate plate--primary" type="submit">
          {t("dashboard.apply")}
        </button>
        <button
          className="plate"
          type="button"
          onClick={() => {
            let next = search;
            for (const name of names) {
              next = withParam(next, name, "");
            }
            onApply(next);
          }}
        >
          {t("dashboard.clear")}
        </button>
      </div>
    </form>
  );
}
