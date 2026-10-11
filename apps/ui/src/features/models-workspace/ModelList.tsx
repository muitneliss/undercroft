import "./workspace.css";
import "./details.css";
import { Link, useSearchParams } from "react-router-dom";
import { formatDateTime } from "@/lib/when.ts";
import { filteredModels, groupKey, orderedModels, PAGE_SIZE } from "./catalog.ts";
import { patchWorkspace, searchWith, useNavigation, useWords, useWorkspace } from "./hooks.ts";
import { GroupLabel, ModelName, Pager } from "./shared.tsx";
import type { Catalog, ModelRecord } from "./types.ts";

const layers = ["", "input", "transform", "output", "unclassified"] as const;
export function ModelList({
  catalog,
  picker = false,
}: {
  catalog: Catalog;
  picker?: boolean;
}): React.JSX.Element {
  const [params] = useSearchParams();
  const go = useNavigation();
  const { t, locale } = useWords();
  const layer = params.get("layer") ?? "";
  const sort = params.get("sort") ?? "name_asc";
  const rows = orderedModels(filteredModels(catalog, params), layer, sort, locale);
  const parsed = Number.parseInt(params.get("page") ?? "1", 10);
  const page = Math.min(
    Math.max(1, Number.isFinite(parsed) ? parsed : 1),
    Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
  );
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <section className="mw-stack">
      {picker === true && <h2>{t("modelsWorkspace.chooseRoot")}</h2>}
      {picker === true && <p>{t("modelsWorkspace.rootHint")}</p>}
      <ListFilters catalog={catalog} />
      <ListResults page={page} total={rows.length} />
      {rows.length === 0 ? (
        <p className="mw-empty">{t("modelsWorkspace.empty")}</p>
      ) : (
        <div className="mw-table-wrap">
          <table className="mw-list-table">
            <thead>
              <tr>
                <th>
                  <GroupHeading layer={layer} />
                </th>
                <th>{t("modelsWorkspace.model")}</th>
                <th>{t("modelsWorkspace.explore")}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((model, index) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  catalog={{ ...catalog, models: rows }}
                  groupStart={
                    index === 0 ||
                    groupKey(pageRows[index - 1] ?? model, layer) !== groupKey(model, layer)
                  }
                  layer={layer}
                  picker={picker}
                  showStatus={sort === "build_desc" || params.has("status") || params.has("build")}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={rows.length} change={(next): void => go({ page: String(next) })} />
    </section>
  );
}
function Filter({
  label,
  value,
  options,
  change,
}: {
  label: string;
  value: string;
  options: string[];
  change: (value: string | null) => void;
}): React.JSX.Element {
  const { t } = useWords();
  return (
    <label className="field">
      {label}
      <select
        className="input input--select"
        value={value}
        onChange={(event): void => change(event.target.value || null)}
      >
        <option value="">{t("modelsWorkspace.all")}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            <GroupLabel id={option} />
          </option>
        ))}
      </select>
    </label>
  );
}
function ModelRow({
  model,
  catalog,
  groupStart,
  layer,
  picker,
  showStatus,
}: {
  model: ModelRecord;
  catalog: Catalog;
  groupStart: boolean;
  layer: string;
  picker: boolean;
  showStatus: boolean;
}): React.JSX.Element | null {
  const { t, locale } = useWords();
  const state = useWorkspace();
  const key = groupKey(model, layer);
  const [params] = useSearchParams();
  const collapseKey = `${layer}:${params.get("page") ?? "1"}:${key}`;
  const collapsed = state.collapsed.includes(collapseKey);
  const count = catalog.models.filter((item) => groupKey(item, layer) === key).length;
  if (collapsed && !groupStart) {
    return null;
  }
  function destination(view: string): string {
    return `?${searchWith(params, {
      view,
      model: model.id,
      profile: null,
      from: null,
      tab: null,
      mode: null,
      dir: null,
      depth: null,
      shown: null,
      expanded: null,
      selection: null,
      rp: null,
    }).toString()}`;
  }
  return (
    <tr data-group-start={groupStart}>
      <td>
        {groupStart === true && (
          <button
            className="mw-group"
            type="button"
            aria-expanded={!collapsed}
            onClick={(): void =>
              patchWorkspace({
                collapsed: collapsed
                  ? state.collapsed.filter((id) => id !== collapseKey)
                  : [...state.collapsed, collapseKey],
              })
            }
          >
            <span>
              {collapsed ? "▸" : "▾"} <GroupLabel id={key} />
            </span>
            <small>{t("modelsWorkspace.models", { count })}</small>
          </button>
        )}
      </td>
      <td>
        {!collapsed && (
          <>
            <Link className="mw-name" to={destination(picker ? "lineage" : "detail")}>
              <ModelName model={model} />
            </Link>
            <p className="mw-description">{model.description[locale]}</p>
            {(showStatus || ["failed", "running", "queued"].includes(model.status)) && (
              <small className="mw-muted" data-failed={model.status === "failed"}>
                {t(`modelsWorkspace.${model.status}`)}
                {t("modelsWorkspace.separator")}
                {formatDateTime(model.builtAt, locale)}
              </small>
            )}
          </>
        )}
      </td>
      <td>
        {!collapsed && (
          <Link className="mw-link" to={destination("lineage")}>
            {t("modelsWorkspace.flow")}
          </Link>
        )}
      </td>
    </tr>
  );
}

function ListFilters({ catalog }: { catalog: Catalog }): React.JSX.Element {
  const [params] = useSearchParams();
  const go = useNavigation();
  const { t } = useWords();
  const layer = params.get("layer") ?? "";
  const countParams = new URLSearchParams(params);
  countParams.delete("layer");
  const counts = filteredModels(catalog, countParams);
  function change(values: Record<string, string | null>): void {
    patchWorkspace({ collapsed: [] });
    go({ ...values, page: null });
  }
  const labels = [
    t("modelsWorkspace.all"),
    t("modelsWorkspace.input"),
    t("modelsWorkspace.transform"),
    t("modelsWorkspace.output"),
    t("modelsWorkspace.unclassified"),
  ];
  const hints: Record<string, string> = {
    input: t("modelsWorkspace.inputHint"),
    transform: t("modelsWorkspace.transformHint"),
    output: t("modelsWorkspace.outputHint"),
    unclassified: t("modelsWorkspace.unclassifiedHint"),
  };
  return (
    <>
      <label className="field">
        <span className="mw-sr">{t("modelsWorkspace.search")}</span>
        <input
          className="input"
          type="search"
          placeholder={t("modelsWorkspace.search")}
          value={params.get("q") ?? ""}
          onChange={(event): void => {
            patchWorkspace({ collapsed: [] });
            go({ q: event.target.value || null, page: null }, true);
          }}
        />
      </label>
      <div className="mw-layers">
        {layers.map((value, index) => (
          <button
            type="button"
            className="plate"
            key={value}
            aria-pressed={layer === value}
            onClick={(): void => change({ layer: value || null })}
          >
            {t("modelsWorkspace.withCount", {
              label: labels[index],
              count: value ? counts.filter((model) => model.layer === value).length : counts.length,
            })}
          </button>
        ))}
      </div>
      <p className="mw-muted">{hints[layer] ?? t("modelsWorkspace.allHint")}</p>
      <AdvancedFilters />
    </>
  );
}

function ListResults({ page, total }: { page: number; total: number }): React.JSX.Element {
  const { t } = useWords();
  const go = useNavigation();
  function change(values: Record<string, string | null>): void {
    patchWorkspace({ collapsed: [] });
    go({ ...values, page: null });
  }
  return (
    <div className="mw-section-head">
      <span aria-live="polite">
        {t("modelsWorkspace.results", {
          count: total,
          start: total > 0 ? (page - 1) * PAGE_SIZE + 1 : 0,
          end: Math.min(page * PAGE_SIZE, total),
        })}
      </span>
      <button
        type="button"
        className="mw-link"
        onClick={(): void =>
          change({
            q: null,
            layer: null,
            domain: null,
            source: null,
            fam: null,
            status: null,
            build: null,
          })
        }
      >
        {t("modelsWorkspace.reset")}
      </button>
      <Pager page={page} total={total} change={(next): void => go({ page: String(next) })} />
    </div>
  );
}

function AdvancedFilters(): React.JSX.Element {
  const { t } = useWords();
  const [params] = useSearchParams();
  const go = useNavigation();
  const sort = params.get("sort") ?? "name_asc";
  function change(values: Record<string, string | null>): void {
    patchWorkspace({ collapsed: [] });
    go({ ...values, page: null });
  }
  return (
    <details className="mw-filters">
      <summary>{t("modelsWorkspace.filters")}</summary>
      <div className="mw-filter-grid">
        <Filter
          label={t("modelsWorkspace.source")}
          value={params.get("source") ?? ""}
          options={["xero", "hubspot", "shopify", "stripe", "unknown"]}
          change={(source): void => change({ source })}
        />
        <Filter
          label={t("modelsWorkspace.domain")}
          value={params.get("domain") ?? ""}
          options={["receivables", "sales", "customers", "inventory", "unknown"]}
          change={(domain): void => change({ domain })}
        />
        <label className="field">
          {t("modelsWorkspace.status")}
          <select
            className="input input--select"
            value={params.get("status") ?? ""}
            onChange={(event): void => change({ status: event.target.value || null, build: null })}
          >
            <option value="">{t("modelsWorkspace.all")}</option>
            {(["success", "failed", "never", "running", "queued"] as const).map((status) => (
              <option key={status} value={status}>
                {t(`modelsWorkspace.${status}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t("modelsWorkspace.sort")}
          <select
            className="input input--select"
            value={sort}
            onChange={(event): void => change({ sort: event.target.value })}
          >
            {(["name_asc", "name_desc", "build_desc"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`modelsWorkspace.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </details>
  );
}

function GroupHeading({ layer }: { layer: string }): React.JSX.Element {
  const { t } = useWords();
  const labels: Record<string, string> = {
    input: t("modelsWorkspace.groupSource"),
    transform: t("modelsWorkspace.groupDomain"),
    output: t("modelsWorkspace.groupDomain"),
    unclassified: t("modelsWorkspace.groupFamily"),
  };
  return <>{labels[layer] ?? t("modelsWorkspace.groupRole")}</>;
}
