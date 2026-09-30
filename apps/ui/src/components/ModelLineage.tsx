/**
 * The lineage view of the Models division: what each model declares it reads, drawn on a board
 * beside the selected node's details, and the same facts as text beneath.
 *
 * Only declared relations are here (ADR 0092): model to model where one `ref`s the other, raw
 * lake table to model where a model -- or a macro it calls -- declares the raw lake as a dbt
 * source. The server reads them; this shows them and adds none. A model whose upstream its
 * declarations cannot show says "upstream not declared" and why, and a ref to a model that is
 * gone is a node of its own, "missing dependency", with its edge kept.
 *
 * Selecting a node -- a card, a neighbour in the details, a name in the text, or the picker --
 * puts it in the address, inks its whole upstream chain, dots its downstream chain, and dims
 * the rest; "only related" narrows the board to those two chains (ADR 0097). The selection is
 * the address and nothing else, so Back retraces a trace one step at a time.
 */

import { useCallback, useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import type { LineageNode, ModelItem, ModelLineage as Graph } from "@/api/types.ts";
import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { LineageCanvas } from "@/components/LineageCanvas.tsx";
import { LineageDetail } from "@/components/LineageDetail.tsx";
import { LineageTrace } from "@/components/LineageTrace.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import {
  drawnGraph,
  type Focus,
  focusOn,
  isRelatedScope,
  lineagePath,
  MODEL_PARAM,
  selectedNode,
} from "@/lib/lineage.ts";
import { formatCount } from "@/lib/money.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const NO_BUILDS: ReadonlyMap<string, ModelItem> = new Map();

export function ModelLineage({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const lineage = trpc.models.lineage.useQuery({ tenantId });

  if (lineage.isPending) {
    return <Skeleton rows={6} />;
  }
  if (lineage.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("lineage.notLoaded", { tenantId })}
      </Errata>
    );
  }
  const graph = lineage.data;
  if (!graph.nodes.some((node) => node.kind === "model")) {
    return <EmptyState title={t("models.emptyTitle")} body={t("lineage.empty")} />;
  }
  return <LineageView graph={graph} tenantId={tenantId} />;
}

function LineageView({ graph, tenantId }: { graph: Graph; tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // The last build of every model, for the cards and the details. Absent until it answers,
  // and a card without it prints no build mark rather than guessing one.
  const list = trpc.models.list.useQuery({ tenantId });
  const builds = useMemo(
    () => (list.data === undefined ? NO_BUILDS : new Map(list.data.map((m) => [m.name, m]))),
    [list.data],
  );
  const asked = params.get(MODEL_PARAM);
  const selected = selectedNode(graph, params);
  const related = isRelatedScope(params) && selected !== null;
  // `selected` is the graph's own node object, so these hold still across a re-render that
  // selects the same node, and the board does not recompute what it draws.
  const focus = useMemo(() => focusOn(graph, selected), [graph, selected]);
  const drawn = useMemo(() => drawnGraph(graph, focus, related), [graph, focus, related]);
  const select = useCallback(
    (name: string | null): void => {
      void navigate(lineagePath(tenantId, name, related));
    },
    [navigate, tenantId, related],
  );

  return (
    <div className="stack">
      <p className="prose">{t("lineage.lead")}</p>
      <Picker graph={graph} related={related} selected={selected} tenantId={tenantId} />
      {asked !== null && selected === null ? (
        <p className="note">{t("lineage.unknownModel", { name: asked })}</p>
      ) : null}
      <Legend focus={focus} graph={graph} />
      <div className="lineage-bench">
        <LineageCanvas builds={builds} drawn={drawn} focus={focus} graph={graph} select={select} />
        <LineageDetail
          builds={builds}
          focus={focus}
          graph={graph}
          select={select}
          tenantId={tenantId}
        />
      </div>
      <LineageTrace focus={focus} graph={graph} tenantId={tenantId} />
    </div>
  );
}

/**
 * The keyboard's way in besides the cards: pick a node by name, narrow the board to it, or
 * clear the selection. Models first, then the raw lake tables, then what is missing.
 */
function Picker({
  graph,
  selected,
  related,
  tenantId,
}: {
  graph: Graph;
  selected: LineageNode | null;
  related: boolean;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const pickerId = useId();
  const navigate = useNavigate();
  const groups: [string, LineageNode[]][] = [
    [t("lineage.groupModels"), graph.nodes.filter((node) => node.kind === "model")],
    [t("lineage.groupRaw"), graph.nodes.filter((node) => node.kind === "raw")],
    [t("lineage.groupMissing"), graph.nodes.filter((node) => node.kind === "missing")],
  ];

  return (
    <form
      className="row row--field"
      onSubmit={(event): void => {
        event.preventDefault();
        const name = String(new FormData(event.currentTarget).get(MODEL_PARAM) ?? "");
        void navigate(lineagePath(tenantId, name === "" ? null : name, related));
      }}
    >
      <div className="field">
        <label className="label" htmlFor={pickerId}>
          {t("lineage.pickLabel")}
        </label>
        <select
          className="input input--select"
          defaultValue={selected?.name ?? ""}
          id={pickerId}
          key={selected?.name ?? ""}
          name={MODEL_PARAM}
        >
          <option value="">{t("lineage.pickNone")}</option>
          {groups.map(([label, nodes]) =>
            nodes.length === 0 ? null : (
              <optgroup key={label} label={label}>
                {nodes.map((node) => (
                  <option key={node.id} value={node.name}>
                    {node.name}
                  </option>
                ))}
              </optgroup>
            ),
          )}
        </select>
      </div>
      <button className="plate plate--primary" type="submit">
        {t("lineage.pick")}
      </button>
      {selected === null ? null : (
        <>
          <Link
            {...(related ? { "aria-current": "true" as const } : {})}
            className="plate"
            to={lineagePath(tenantId, selected.name, !related)}
          >
            {related ? t("lineage.showAll") : t("lineage.onlyRelated")}
          </Link>
          <Link className="plate" to={lineagePath(tenantId)}>
            {t("lineage.clear")}
          </Link>
        </>
      )}
    </form>
  );
}

/** What each stroke and mark means, and how much of the graph the selection lights. */
function Legend({ graph, focus }: { graph: Graph; focus: Focus }): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const total = formatCount(graph.nodes.length, locale);
  const lit =
    focus.chain === null ? null : new Set([...focus.chain, ...(focus.downstream ?? [])]).size;
  return (
    <p className="lineage-legend">
      <span className="lineage-legend__key">{t("lineage.keyDeclared")}</span>
      <span className="lineage-legend__key lineage-legend__key--downstream">
        {t("lineage.keyDownstream")}
      </span>
      <span className="lineage-legend__key lineage-legend__key--missing">
        {t("lineage.keyMissing")}
      </span>
      <span>{t("lineage.keyUndeclared")}</span>
      <span className="datum datum--quiet">
        {lit === null
          ? t("lineage.nodeCount", { total })
          : t("lineage.litCount", { lit: formatCount(lit, locale), total })}
      </span>
    </p>
  );
}
