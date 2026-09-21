/**
 * The shared filters at the top of a dashboard, as a form that writes the URL.
 *
 * Nothing here holds a value: the search string does, under `p.<name>` as a question's own
 * parameters do, so the tiles beneath read the same values a colleague gets by opening the
 * link. A date range offers the four presets an operator reaches for as plates that apply
 * at once, and a from/to pair for anything else; text and number are one input each.
 * Apply writes every filter's value in one step; Clear removes them all.
 */

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
            onClick={(): void => {
              const range = presetRange(preset);
              onApply(withParam(withParam(search, from, range.from), to, range.to));
            }}
          >
            {t(PRESET_KEY[preset])}
          </button>
        ))}
      </div>
      <div className="row row--field">
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
      onSubmit={(event): void => {
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
          onClick={(): void => {
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
