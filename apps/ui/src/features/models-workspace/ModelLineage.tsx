import { Expand } from "./Expand.tsx";
import { scopeFacts } from "./scope.ts";
import "./workspace.css";
import "./details.css";
import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { GRAPH_LIMIT, related } from "./catalog.ts";
import { patchWorkspace, useNarrowScreen, useNavigation, useWords, useWorkspace } from "./hooks.ts";
import { ModelChooser } from "./ModelChooser.tsx";
import { GroupLabel, ModelName, Pager } from "./shared.tsx";
import type { Catalog, Direction } from "./types.ts";

const Graph = lazy(async () => ({ default: (await import("./ModelGraph.tsx")).ModelGraph }));

export function ModelLineage({
  catalog,
  root,
}: {
  catalog: Catalog;
  root: string;
}): React.JSX.Element {
  const { t, locale } = useWords();
  const state = useWorkspace();
  const [params] = useSearchParams();
  const go = useNavigation();
  const { direction, depthValue, ids, visible } = scopeFacts(catalog, root, params);
  const model = catalog.models.find((item) => item.id === root);
  const narrow = useNarrowScreen();
  const table =
    params.get("mode") === "table" ||
    (params.get("shown")?.split(",").length ?? 0) > GRAPH_LIMIT ||
    narrow;
  const { changeScope, apply } = useLineageActions(root);
  return (
    <section className="mw-stack">
      <div className="mw-section-head">
        <div>
          <span className="mw-eyebrow">{t("modelsWorkspace.root")}</span>
          <h2>{model?.title[locale] ?? root}</h2>
          <code>{root}</code>
        </div>
        <div className="mw-actions">
          <button type="button" className="mw-link" onClick={(): void => go({ model: null })}>
            {t("modelsWorkspace.changeRoot")}
          </button>
          <button
            type="button"
            className="plate"
            onClick={(): void => changeScope({ dir: "down", depth: "all", mode: "table" })}
          >
            {t("modelsWorkspace.impact")}
          </button>
        </div>
      </div>
      <LineageControls
        direction={direction}
        depthValue={depthValue}
        table={table}
        changeScope={changeScope}
      />
      <p className="mw-caption">{t("modelsWorkspace.scopeNote")}</p>
      {narrow && <p className="mw-note">{t("modelsWorkspace.narrowScreen")}</p>}
      <ScopeToolbar ids={ids} visible={visible} root={root} />
      {params.has("expanded") && (
        <p className="mw-caption">
          {t("modelsWorkspace.branchCount", {
            count: params.get("expanded")?.split(",").length ?? 0,
          })}
        </p>
      )}
      {(params.get("shown")?.split(",").length ?? 0) > GRAPH_LIMIT && (
        <p className="mw-note">{t("modelsWorkspace.largeSelection")}</p>
      )}
      {table ? (
        <RelationTable
          catalog={catalog}
          ids={
            params.get("selection") === "chosen"
              ? ids.filter((id) => (params.get("shown")?.split(",") ?? []).includes(id))
              : ids
          }
          root={root}
          direction={direction}
        />
      ) : (
        <ScopeGraph catalog={catalog} visible={visible} ids={ids} root={root} />
      )}
      {Boolean(state.quickModel) && <QuickView catalog={catalog} id={state.quickModel ?? ""} />}
      {state.chooser === true && (
        <ModelChooser catalog={catalog} ids={ids} root={root} apply={apply} />
      )}
    </section>
  );
}
function RelationTable({
  catalog,
  ids,
  root,
  direction,
}: {
  catalog: Catalog;
  ids: string[];
  root: string;
  direction: Direction;
}): React.JSX.Element {
  const { t } = useWords();
  const [params] = useSearchParams();
  const go = useNavigation();
  const page = Math.min(
    Math.max(1, Number.parseInt(params.get("rp") ?? "1", 10) || 1),
    Math.max(1, Math.ceil(ids.length / 25)),
  );
  const relations = related(catalog, root, direction, catalog.models.length + 2);
  return (
    <div className="mw-stack">
      {params.get("selection") === "chosen" && (
        <div className="mw-note">
          {t("modelsWorkspace.tableSelection")}
          {t("modelsWorkspace.space")}
          <button type="button" className="mw-link" onClick={(): void => go({ selection: null })}>
            {t("modelsWorkspace.clearTable")}
          </button>
        </div>
      )}
      <div className="mw-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("modelsWorkspace.model")}</th>
              <th>{t("modelsWorkspace.group")}</th>
              <th>{t("modelsWorkspace.relationship")}</th>
              <th>{t("modelsWorkspace.explore")}</th>
            </tr>
          </thead>
          <tbody>
            {ids.slice((page - 1) * 25, page * 25).map((id) => {
              const model = catalog.models.find((item) => item.id === id);
              const relation = relations.get(id);
              return (
                <tr key={id}>
                  <td>
                    <button
                      className="mw-name"
                      type="button"
                      onClick={(): void => patchWorkspace({ quickModel: id })}
                    >
                      {model ? <ModelName model={model} /> : <code>{id}</code>}
                    </button>
                  </td>
                  <td>
                    <GroupLabel id={model?.layer ?? "raw"} />
                  </td>
                  <td>
                    {id === root
                      ? t("modelsWorkspace.center")
                      : relation
                        ? t(
                            relation.direction === "up"
                              ? "modelsWorkspace.upstream"
                              : "modelsWorkspace.downstream",
                            { steps: relation.distance },
                          )
                        : t("modelsWorkspace.branch")}
                  </td>
                  <td>
                    <Expand catalog={catalog} id={id} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={ids.length} change={(next): void => go({ rp: String(next) })} />
    </div>
  );
}

function QuickView({ catalog, id }: { catalog: Catalog; id: string }): React.JSX.Element {
  const { t, locale } = useWords();
  const go = useNavigation();
  const model = catalog.models.find((item) => item.id === id);
  return (
    <aside className="mw-quick mw-card" aria-label={t("modelsWorkspace.quick")}>
      <div className="mw-section-head">
        <h3>{model?.title[locale] ?? id}</h3>
        <button
          className="mw-link"
          type="button"
          onClick={(): void => patchWorkspace({ quickModel: null })}
        >
          {t("modelsWorkspace.close")}
        </button>
      </div>
      <code>{id}</code>
      <p>{model?.description[locale] ?? t("modelsWorkspace.raw")}</p>
      <div className="mw-actions">
        {model && (
          <button
            className="plate"
            type="button"
            onClick={(): void => go({ view: "detail", profile: id, from: "lineage", tab: null })}
          >
            {t("modelsWorkspace.openProfile")}
          </button>
        )}
        <button
          type="button"
          className="plate"
          onClick={(): void =>
            go({
              model: id,
              dir: "both",
              depth: "1",
              shown: null,
              expanded: null,
              selection: null,
              rp: null,
            })
          }
        >
          {t("modelsWorkspace.makeRoot")}
        </button>
        <Expand catalog={catalog} id={id} />
      </div>
    </aside>
  );
}

function LineageControls({
  direction,
  depthValue,
  table,
  changeScope,
}: {
  direction: Direction;
  depthValue: string;
  table: boolean;
  changeScope: (values: Record<string, string | null>) => void;
}): React.JSX.Element {
  const { t } = useWords();
  const go = useNavigation();
  const narrow = useNarrowScreen();
  const [params] = useSearchParams();
  return (
    <div className="mw-lineage-controls">
      <label className="field">
        {t("modelsWorkspace.direction")}
        <select
          className="input input--select"
          value={direction}
          onChange={(event): void => changeScope({ dir: event.target.value })}
        >
          {(["both", "up", "down"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`modelsWorkspace.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {t("modelsWorkspace.depth")}
        <select
          className="input input--select"
          value={depthValue}
          onChange={(event): void => changeScope({ depth: event.target.value })}
        >
          <option value="1">{t("modelsWorkspace.oneStep")}</option>
          <option value="2">{t("modelsWorkspace.twoSteps")}</option>
          <option value="3">{t("modelsWorkspace.threeSteps")}</option>
          <option value="all">{t("modelsWorkspace.allSteps")}</option>
        </select>
      </label>
      <div className="mw-actions">
        <button
          type="button"
          className="plate"
          aria-pressed={!table}
          disabled={narrow || (params.get("shown")?.split(",").length ?? 0) > GRAPH_LIMIT}
          onClick={(): void => go({ mode: "graph", selection: null })}
        >
          {t("modelsWorkspace.graph")}
        </button>
        <button
          type="button"
          className="plate"
          aria-pressed={table}
          onClick={(): void => go({ mode: "table" })}
        >
          {t("modelsWorkspace.table")}
        </button>
      </div>
    </div>
  );
}

function ScopeToolbar({
  ids,
  visible,
  root,
}: {
  ids: string[];
  visible: string[];
  root: string;
}): React.JSX.Element {
  const { t } = useWords();
  const state = useWorkspace();
  const [params, setParams] = useSearchParams();
  return (
    <div className="mw-section-head">
      <span aria-live="polite">{t("modelsWorkspace.scopeCount", { count: ids.length - 1 })}</span>
      <div className="mw-actions">
        <button
          type="button"
          className="mw-link"
          disabled={!state.undo}
          onClick={(): void => {
            if (state.undo) {
              setParams(new URLSearchParams(state.undo.query));
              patchWorkspace({ undo: null, quickModel: null });
            }
          }}
        >
          {t("modelsWorkspace.undo")}
        </button>
        <button
          className="plate"
          type="button"
          onClick={(): void =>
            patchWorkspace({
              chooser: true,
              selected: (params.get("shown")?.split(",") ?? visible).filter((id) => id !== root),
            })
          }
        >
          {t("modelsWorkspace.showMore")}
        </button>
      </div>
    </div>
  );
}

function ScopeGraph({
  catalog,
  visible,
  ids,
  root,
}: {
  catalog: Catalog;
  visible: string[];
  ids: string[];
  root: string;
}): React.JSX.Element {
  const { t } = useWords();
  return (
    <>
      <p className="mw-muted">
        {t("modelsWorkspace.drawCount", { shown: visible.length, total: ids.length })}
      </p>
      <div className="mw-role-legend">
        {(["input", "transform", "output", "unclassified"] as const).map((layer) => (
          <span key={layer}>
            <GroupLabel id={layer} />
            {t("modelsWorkspace.separator")}
            {
              visible.filter((id) => catalog.models.find((item) => item.id === id)?.layer === layer)
                .length
            }
          </span>
        ))}
      </div>
      <Suspense fallback={<p>{t("modelsWorkspace.loading")}</p>}>
        <Graph catalog={catalog} ids={visible} root={root} />
      </Suspense>
    </>
  );
}

function useLineageActions(root: string): {
  changeScope: (changes: Record<string, string | null>) => void;
  apply: (asTable: boolean) => void;
} {
  const state = useWorkspace();
  const [params] = useSearchParams();
  const go = useNavigation();
  function changeScope(changes: Record<string, string | null>): void {
    patchWorkspace({
      undo: { query: params.toString() },
      visible: [],
      expanded: [],
      quickModel: null,
    });
    go({ ...changes, rp: null, selection: null, shown: null, expanded: null });
  }
  function apply(asTable: boolean): void {
    patchWorkspace({
      undo: { query: params.toString() },
      visible: [root, ...state.selected],
      chooser: false,
    });
    go({
      mode: asTable ? "table" : "graph",
      selection: asTable ? "chosen" : null,
      shown: [root, ...state.selected].join(","),
      rp: null,
    });
  }
  return { changeScope, apply };
}
