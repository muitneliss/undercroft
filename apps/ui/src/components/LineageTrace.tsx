/**
 * The lineage as text, beneath the board: the route by keyboard and screen reader, and the whole
 * view below 760px, where the board steps aside. It wraps rather than clips, so every name stays
 * readable at any width.
 *
 * With nothing selected it lists every model and what it reads. With a node selected it traces
 * it (ADR 0097): every name on its upstream chain, every path from a node that reads nothing
 * declared down to it -- the thing a reader following a wrong figure back to the raw lake
 * actually walks -- and every name downstream of it, what a failure here reaches. Where the
 * chain holds a missing dependency or an upstream that is not declared, it says so before the
 * names, because the paths stop there and must not read as complete.
 */

import type { TFunction } from "i18next";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { LineageNode, ModelLineage as Graph } from "@/api/types.ts";
import { NodeLink } from "@/components/LineageNode.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import {
  type Focus,
  nodeState,
  nodeWords,
  PATH_LIMIT,
  parentsOf,
  reasonText,
  upstreamPaths,
} from "@/lib/lineage.ts";
import { layout } from "@/lib/lineageLayout.ts";
import { MISSING } from "@/lib/money.ts";

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

export function LineageTrace({
  graph,
  focus,
  tenantId,
}: {
  graph: Graph;
  focus: Focus;
  tenantId: string;
}): React.JSX.Element {
  const { selected } = focus;
  return selected === null ? (
    <EveryModel graph={graph} tenantId={tenantId} />
  ) : (
    <Trace focus={focus} graph={graph} selected={selected} tenantId={tenantId} />
  );
}

/** Every model and what it reads, and why where that cannot be read. */
function EveryModel({ graph, tenantId }: { graph: Graph; tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const headId = useId();
  const models = layout(graph).placed.filter((p) => p.node.kind === "model");
  return (
    <section aria-labelledby={headId} className="stack stack--tight">
      <h2 className="label" id={headId}>
        {t("lineage.allHead")}
      </h2>
      <ol className="lineage__list">
        {models.map(({ node }) => (
          <li className="lineage__item" key={node.id}>
            <NodeLink className="journal__what" current={false} node={node} tenantId={tenantId}>
              {node.name}
            </NodeLink>
            {nodeWords(t, node, "plain").map((word) => (
              <span className="label" key={word}>
                {word}
              </span>
            ))}
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
        ))}
      </ol>
    </section>
  );
}

/** A run of names, each a link that selects it, with its words beside it. */
function Names({
  nodes,
  focus,
  tenantId,
}: {
  nodes: readonly LineageNode[];
  focus: Focus;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (nodes.length === 0) {
    return <p className="datum datum--quiet">{MISSING}</p>;
  }
  return (
    <ul className="lineage-names">
      {nodes.map((node) => {
        const words = nodeWords(t, node, nodeState(focus, node.id)).filter(
          (word) => word !== t("lineage.onChain") && word !== t("lineage.downstream"),
        );
        return (
          <li key={node.id}>
            <NodeLink className="journal__what" current={false} node={node} tenantId={tenantId}>
              {node.name}
            </NodeLink>
            {words.length > 0 ? <span className="label">{words.join(" · ")}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** One path, raw lake first, each hop naming the macro that declares it where one does. */
function Path({
  graph,
  ids,
  tenantId,
}: {
  graph: Graph;
  ids: readonly string[];
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  // A flat list of keyed parts rather than a keyed `Fragment`, which Biome cannot resolve out
  // of React's types (the same answer `People.tsx` gives).
  return (
    <li>
      {ids.flatMap((id, at) => {
        const node = graph.nodes.find((n) => n.id === id);
        const next = ids[at + 1];
        const via = graph.edges.find((edge) => edge.from === id && edge.to === next)?.via ?? null;
        return [
          node === undefined ? (
            <span key={`${id}-name`}>{id}</span>
          ) : (
            <NodeLink
              className="journal__what"
              current={false}
              key={`${id}-name`}
              node={node}
              tenantId={tenantId}
            >
              {node.name}
            </NodeLink>
          ),
          via === null ? null : (
            <span className="datum datum--quiet lineage-paths__via" key={`${id}-via`}>
              {t("lineage.pathVia", { via })}
            </span>
          ),
          // The arrow is the sheet's (`::before`), so it is drawn and never read aloud twice.
          next === undefined ? null : (
            <span aria-hidden="true" className="lineage-paths__arrow" key={`${id}-to`} />
          ),
        ];
      })}
    </li>
  );
}

function Trace({
  graph,
  focus,
  selected,
  tenantId,
}: {
  graph: Graph;
  focus: Focus;
  selected: LineageNode;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const headId = useId();
  const { placed } = layout(graph);
  const up = placed
    .filter((p) => focus.chain?.has(p.node.id) === true && p.node.id !== selected.id)
    .sort((a, b) => b.column - a.column)
    .map((p) => p.node);
  const down = placed
    .filter((p) => focus.downstream?.has(p.node.id) === true && p.node.id !== selected.id)
    .sort((a, b) => a.column - b.column)
    .map((p) => p.node);
  const { paths, more } = upstreamPaths(graph, selected.id);
  const missing = up.filter((node) => node.kind === "missing").map((node) => node.name);
  const undeclaredAbove = up.some((node) => node.kind === "model" && node.undeclared.length > 0);

  return (
    <section aria-labelledby={headId} className="lineage-trace stack">
      <div className="lineage-trace__top">
        <h2 className="lineage-trace__head" id={headId}>
          {t("lineage.chainHead", { name: selected.name, count: up.length })}
        </h2>
        {selected.kind === "model" ? (
          <Link
            className="plate plate--small"
            to={`${divisionPath("models", tenantId)}/${selected.name}`}
          >
            {t("lineage.openEditor")}
          </Link>
        ) : null}
      </div>
      {selected.kind === "model" && selected.undeclared.length > 0 ? (
        <p className="note">{t("lineage.traceUndeclared")}</p>
      ) : null}
      {missing.length > 0 ? (
        <p className="note">{t("lineage.traceMissing", { names: missing.join(", ") })}</p>
      ) : null}
      {undeclaredAbove ? <p className="note">{t("lineage.traceUndeclaredAbove")}</p> : null}

      <h3 className="label">{t("lineage.everyName", { count: up.length })}</h3>
      <Names focus={focus} nodes={up} tenantId={tenantId} />

      <h3 className="label">{t("lineage.pathsHead")}</h3>
      {paths.length === 0 || (paths.length === 1 && paths[0]?.length === 1) ? (
        <p className="datum datum--quiet">{MISSING}</p>
      ) : (
        <ol className="lineage-paths">
          {paths.map((ids) => (
            <Path graph={graph} ids={ids} key={ids.join("|")} tenantId={tenantId} />
          ))}
        </ol>
      )}
      {more ? <p className="note">{t("lineage.pathsMore", { count: PATH_LIMIT })}</p> : null}

      <h3 className="label">
        {t("lineage.downstreamHead", { name: selected.name, count: down.length })}
      </h3>
      <Names focus={focus} nodes={down} tenantId={tenantId} />
    </section>
  );
}
