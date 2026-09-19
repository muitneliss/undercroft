/**
 * Defining a dashboard's filters: what each is called, what kind it is, and what a reader
 * sees above it.
 *
 * The NAME is the `{{hole}}` a question's SQL carries, which is why it must be an identifier
 * and why two filters cannot share one -- the second would silently win, and a dashboard
 * whose filter binds nothing looks exactly like one whose filter binds everything.
 *
 * Nothing here interpolates: the name travels as a parameter and the server binds it.
 */

import type { DashboardFilter } from "@undercroft/contracts/bi";
import { useTranslation } from "react-i18next";

import { useUiStore } from "@/store.ts";

/**
 * Defining the filters: a name a query can bind, a kind, and a label a reader sees.
 *
 * The name is the `{{hole}}` a question's SQL carries, which is why it is an identifier and
 * why two filters cannot share one -- the second would silently win.
 */
export function FilterEditor({
  filters,
  valid,
}: {
  filters: readonly DashboardFilter[];
  valid: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const setDashboardFilters = useUiStore((state) => state.setDashboardFilters);

  return (
    <>
      <div className="band-rule" />
      <div className="head">{t("dashboard.filtersEditHead")}</div>
      <div className="body stack">
        <p className="prose">
          {t("dashboard.filtersEditLead", {
            from: "{{period_from}}",
            to: "{{period_to}}",
            name: "{{stage}}",
          })}
        </p>
        {filters.map((filter, i) => (
          // Keyed by position: a filter is identified by where it sits until it is named.
          <FilterRow key={String(i)} filter={filter} at={i} filters={filters} />
        ))}
        <div className="row">
          <button
            className="plate"
            type="button"
            onClick={(): void => {
              setDashboardFilters([...filters, { name: "", kind: "text", label: "" }]);
            }}
          >
            {t("dashboard.addFilter")}
          </button>
          {valid ? null : (
            <span className="datum datum--quiet">{t("dashboard.filterNameHint")}</span>
          )}
        </div>
      </div>
    </>
  );
}

/** One filter's three fields, and the plate that removes it. */
function FilterRow({
  filter,
  at,
  filters,
}: {
  filter: DashboardFilter;
  at: number;
  filters: readonly DashboardFilter[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const setDashboardFilters = useUiStore((state) => state.setDashboardFilters);
  const i = at;

  return (
    <div key={String(i)} className="row builder__filter">
      <div className="field">
        <label className="label" htmlFor={`d-filter-name-${String(i)}`}>
          {t("dashboard.filterName")}
        </label>
        <input
          autoComplete="off"
          className="input"
          id={`d-filter-name-${String(i)}`}
          maxLength={63}
          pattern="[A-Za-z_][A-Za-z0-9_]*"
          title={t("dashboard.filterNameHint")}
          type="text"
          value={filter.name}
          onChange={(event): void => {
            const name = event.currentTarget.value;
            setDashboardFilters(filters.map((held, j) => (j === i ? { ...held, name } : held)));
          }}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor={`d-filter-kind-${String(i)}`}>
          {t("dashboard.filterKind")}
        </label>
        <select
          className="input input--select"
          id={`d-filter-kind-${String(i)}`}
          value={filter.kind}
          onChange={(event): void => {
            const chosen = event.currentTarget.value;
            const kind = chosen === "date_range" || chosen === "number" ? chosen : "text";
            setDashboardFilters(filters.map((held, j) => (j === i ? { ...held, kind } : held)));
          }}
        >
          <option value="text">{t("dashboard.kindText")}</option>
          <option value="number">{t("dashboard.kindNumber")}</option>
          <option value="date_range">{t("dashboard.kindDateRange")}</option>
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor={`d-filter-label-${String(i)}`}>
          {t("dashboard.filterLabel")}
        </label>
        <input
          autoComplete="off"
          className="input"
          id={`d-filter-label-${String(i)}`}
          maxLength={80}
          type="text"
          value={filter.label}
          onChange={(event): void => {
            const label = event.currentTarget.value;
            setDashboardFilters(filters.map((held, j) => (j === i ? { ...held, label } : held)));
          }}
        />
      </div>
      <button
        className="plate plate--small"
        type="button"
        onClick={(): void => {
          setDashboardFilters(filters.filter((_held, j) => j !== i));
        }}
      >
        {t("dashboard.removeFilter")}
      </button>
    </div>
  );
}
