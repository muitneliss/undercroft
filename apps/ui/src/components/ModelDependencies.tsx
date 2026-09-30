/**
 * One model's dependencies, on its own editor: what its saved SQL declares it reads, why where
 * that cannot be read, and which models declare that they read it.
 *
 * Read from `models.lineage` (ADR 0092), the same graph the lineage view draws, so the two can
 * never disagree; nothing here reads the SQL itself or adds an edge. Only DECLARED relations
 * are listed -- a `ref()` to a model, a `source()` on the raw lake, a macro's included -- and a
 * model whose declarations cannot show its upstream says so and why rather than listing
 * nothing, because an empty list there would read as proof of no dependency.
 *
 * Each name is a door to where that thing is dealt with: a model to its own editor, a raw lake
 * table to the Raw lake, and a ref to a model that no longer exists -- which has no page of its
 * own -- to its node in the lineage view, where the rest of what it breaks is traced. The ref is
 * kept and named as missing (ADR 0077): deleting a model leaves the models that ref it in place.
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { LineageNode, ModelLineage as Graph } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { NodeLink } from "@/components/LineageNode.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { childrenOf, nodeWords, parentsOf, reasonText } from "@/lib/lineage.ts";
import { MISSING } from "@/lib/money.ts";
import { trpc } from "@/trpc.ts";

type Edge = Graph["edges"][number];

export function ModelDependencies({
  tenantId,
  name,
}: {
  tenantId: string;
  name: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const lineage = trpc.models.lineage.useQuery({ tenantId });

  if (lineage.isPending) {
    return <Skeleton rows={2} />;
  }
  if (lineage.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("lineage.notLoaded", { tenantId })}
      </Errata>
    );
  }

  const graph = lineage.data;
  const node = graph.nodes.find((n) => n.kind === "model" && n.name === name);
  if (node === undefined || node.kind !== "model") {
    // The graph has not caught up with a model this new: say nothing rather than "reads nothing".
    return <p className="datum datum--quiet">{MISSING}</p>;
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  return (
    <>
      <p className="prose">{t("models.dependenciesLead")}</p>
      <section className="stack stack--tight">
        <h2 className="label">{t("lineage.readsHead")}</h2>
        <Neighbours
          byId={byId}
          edges={parentsOf(graph, node.id)}
          empty={node.undeclared.length === 0 ? t("lineage.readsNothing") : null}
          end="from"
          tenantId={tenantId}
        />
        {node.undeclared.length > 0 ? (
          <>
            <p className="label">{t("lineage.undeclared")}</p>
            <ul className="note">
              {node.undeclared.map((reason) => (
                <li key={`${reason.code}|${reason.subject ?? ""}|${reason.via ?? ""}`}>
                  {reasonText(t, reason)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
      <section className="stack stack--tight">
        <h2 className="label">{t("lineage.readByHead")}</h2>
        <Neighbours
          byId={byId}
          edges={childrenOf(graph, node.id)}
          empty={t("lineage.readByNothing")}
          end="to"
          tenantId={tenantId}
        />
      </section>
    </>
  );
}

/** One side's neighbours, each a door to where it is dealt with, with its words beside it. */
function Neighbours({
  edges,
  end,
  byId,
  empty,
  tenantId,
}: {
  edges: readonly Edge[];
  end: "from" | "to";
  byId: ReadonlyMap<string, LineageNode>;
  /** What to say when there are none; `null` says nothing, where the reason is said below. */
  empty: string | null;
  tenantId: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (edges.length === 0) {
    return empty === null ? null : <p className="datum datum--quiet">{empty}</p>;
  }
  return (
    <ul className="lineage-names">
      {edges.map((edge) => {
        const node = byId.get(edge[end]);
        if (node === undefined) {
          return null;
        }
        const words =
          node.kind === "missing" ? [t("lineage.keyMissing")] : nodeWords(t, node, "plain");
        return (
          <li key={node.id}>
            <Door node={node} tenantId={tenantId} />
            {words.length > 0 ? <span className="label">{words.join(" · ")}</span> : null}
            {edge.via === null ? null : (
              <span className="datum datum--quiet">{t("lineage.via", { via: edge.via })}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Door({ node, tenantId }: { node: LineageNode; tenantId: string }): React.JSX.Element {
  switch (node.kind) {
    case "model":
      return (
        <Link className="journal__what" to={`${divisionPath("models", tenantId)}/${node.name}`}>
          {node.name}
        </Link>
      );
    case "raw":
      return (
        <Link className="journal__what" to={divisionPath("lake", tenantId)}>
          {node.name}
        </Link>
      );
    default:
      return (
        <NodeLink className="journal__what" current={false} node={node} tenantId={tenantId}>
          {node.name}
        </NodeLink>
      );
  }
}
