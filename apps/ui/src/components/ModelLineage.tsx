/**
 * The lineage view of the Models division: what each model declares it reads, drawn, and the
 * same facts as text.
 *
 * Only declared relations are here (ADR 0092): model to model where one `ref`s the other, raw
 * lake table to model where a model -- or a macro it calls -- declares the raw lake as a dbt
 * source. The server reads them; this shows them and adds none. A model whose upstream its
 * declarations cannot show says "upstream not declared" and why, and a ref to a model that is
 * gone is a node of its own, "missing dependency", with its edge kept.
 *
 * Selecting a model -- a node, or the picker -- puts it in the address and highlights its
 * whole upstream chain; everything else is dimmed. The text list beneath the drawing names
 * every node of that chain with what it reads, so the chain can be followed by keyboard and
 * screen reader, and below 760px, where the drawing steps aside, the list is the view: it
 * wraps rather than clips, so every name in the chain stays readable.
 */

import type { TFunction } from "i18next";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import type { LineageNode, ModelLineage as Graph } from "@/api/types.ts";
import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { LineageDrawing } from "@/components/LineageDrawing.tsx";
import { NodeLink } from "@/components/LineageNode.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import {
  type Focus,
  LINEAGE_VIEW,
  layout,
  lineagePath,
  MODEL_PARAM,
  nodeState,
  nodeWords,
  parentsOf,
  selectedModel,
  upstreamOf,
  VIEW_PARAM,
} from "@/lib/lineage.ts";
import { trpc } from "@/trpc.ts";

type Undeclared = Extract<LineageNode, { kind: "model" }>["undeclared"][number];

export function ModelLineage({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
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
  const selected = selectedModel(graph, params);
  const focus: Focus = {
    selected,
    chain: selected === null ? null : upstreamOf(graph, selected.id),
  };
  const asked = params.get(MODEL_PARAM);

  return (
    <div className="stack">
      <p className="prose">{t("lineage.lead")}</p>
      <Picker graph={graph} selected={selected} tenantId={tenantId} />
      {asked !== null && selected === null ? (
        <p className="note">{t("lineage.unknownModel", { name: asked })}</p>
      ) : null}
      <LineageDrawing focus={focus} graph={graph} tenantId={tenantId} />
      <LineageText focus={focus} graph={graph} tenantId={tenantId} />
    </div>
  );
}

/** The keyboard's way in besides the nodes: pick a model by name, or clear the selection. */
function Picker({
  graph,
  selected,
  tenantId,
}: {
  graph: Graph;
  selected: LineageNode | null;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const pickerId = useId();
  const [, setParams] = useSearchParams();
  const models = graph.nodes.filter((node) => node.kind === "model");

  return (
    <form
      className="row row--field"
      onSubmit={(event): void => {
        event.preventDefault();
        const name = String(new FormData(event.currentTarget).get(MODEL_PARAM) ?? "");
        setParams(
          name === ""
            ? { [VIEW_PARAM]: LINEAGE_VIEW }
            : { [VIEW_PARAM]: LINEAGE_VIEW, [MODEL_PARAM]: name },
        );
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
          {models.map((node) => (
            <option key={node.id} value={node.name}>
              {node.name}
            </option>
          ))}
        </select>
      </div>
      <button className="plate" type="submit">
        {t("lineage.pick")}
      </button>
      {selected === null ? null : (
        <Link className="plate" to={lineagePath(tenantId)}>
          {t("lineage.clear")}
        </Link>
      )}
    </form>
  );
}

/** One reason, worded: which declaration could not be read, and in which macro if not here. */
function reasonText(t: TFunction, { code, subject, via }: Undeclared): string {
  const values = { subject: subject ?? "", via: via ?? "" };
  const here = via === null;
  switch (code) {
    case "dynamic-reference":
      return here ? t("lineage.reasonDynamic", values) : t("lineage.reasonDynamicVia", values);
    case "unknown-macro":
      return here
        ? t("lineage.reasonUnknownMacro", values)
        : t("lineage.reasonUnknownMacroVia", values);
    case "direct-read":
      return here ? t("lineage.reasonDirect", values) : t("lineage.reasonDirectVia", values);
    default:
      return here ? t("lineage.reasonQuery", values) : t("lineage.reasonQueryVia", values);
  }
}

/** What a node reads, as text: its parents by name, a macro's declaration saying which. */
function readsText(t: TFunction, graph: Graph, node: LineageNode): string {
  if (node.kind === "raw") {
    return t("lineage.rawTableLong");
  }
  if (node.kind === "missing") {
    return t("lineage.missingLong");
  }
  const parents = parentsOf(graph, node.id);
  if (parents.length === 0) {
    return t("lineage.readsNothing");
  }
  const names = parents.map((edge) => {
    const name = graph.nodes.find((n) => n.id === edge.from)?.name ?? edge.from;
    return edge.via === null ? name : t("lineage.readVia", { name, via: edge.via });
  });
  return t("lineage.reads", { names: names.join(", ") });
}

/**
 * The view as text: with a model selected, every node on its chain, the selected one first and
 * then from the nearest column down to the raw lake; with none, every model. Each says what it
 * reads and, where that cannot be read, why.
 */
function LineageText({
  graph,
  focus,
  tenantId,
}: {
  graph: Graph;
  focus: Focus;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const headId = useId();
  const { placed } = layout(graph);
  const listed =
    focus.chain === null
      ? placed.filter((p) => p.node.kind === "model")
      : placed
          .filter((p) => focus.chain?.has(p.node.id) === true)
          .sort((a, b) => b.column - a.column);

  return (
    <section aria-labelledby={headId} className="stack stack--tight">
      <h2 className="label" id={headId}>
        {focus.selected === null
          ? t("lineage.allHead")
          : t("lineage.chainHead", { name: focus.selected.name, count: listed.length - 1 })}
      </h2>
      <ol className="lineage__list">
        {listed.map(({ node }) => {
          const state = nodeState(focus, node.id);
          const words = nodeWords(t, node, state);
          return (
            <li className="lineage__item" key={node.id}>
              <NodeLink
                className="journal__what"
                current={state === "selected"}
                node={node}
                tenantId={tenantId}
              >
                {node.name}
              </NodeLink>
              {words.length > 0 ? <span className="label">{words.join(" · ")}</span> : null}
              <p className="datum datum--quiet">{readsText(t, graph, node)}</p>
              {node.kind === "model" && node.undeclared.length > 0 ? (
                <ul className="note">
                  {node.undeclared.map((reason) => (
                    <li key={`${reason.code}|${reason.subject ?? ""}|${reason.via ?? ""}`}>
                      {reasonText(t, reason)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
