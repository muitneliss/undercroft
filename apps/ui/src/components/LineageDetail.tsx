/**
 * Beside the lineage board: everything a reader tracing a failure needs about the selected
 * node without leaving the view -- its last build and the run that made it, the columns that
 * build produced, its SQL, what it reads and what reads it, and why its upstream cannot be read
 * where it cannot.
 *
 * Each neighbour is a button that selects it, so a chain is followed one press at a time and
 * Back retraces it (the selection is in the address). Every fact here is one the server already
 * answers -- `models.lineage`, `models.list`, `models.get` -- read through the same hooks the
 * rest of the division uses; nothing is computed that the platform does not state.
 */

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { LineageNode, ModelItem, ModelLineage as Graph } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { StatusMark } from "@/components/StatusMark.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import {
  childrenOf,
  type Focus,
  kindWord,
  nodeState,
  parentsOf,
  reasonText,
  stateWord,
} from "@/lib/lineage.ts";
import { buildMark, buildMarkLabel } from "@/lib/modelBuild.ts";
import { formatCount } from "@/lib/money.ts";
import { formatDateTime, relativeTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

type Edge = Graph["edges"][number];

export function LineageDetail({
  graph,
  focus,
  builds,
  tenantId,
  select,
}: {
  graph: Graph;
  focus: Focus;
  builds: ReadonlyMap<string, ModelItem>;
  tenantId: string;
  select: (name: string | null) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const headId = useId();
  const node = focus.selected;

  if (node === null) {
    function count(kind: LineageNode["kind"]): string {
      return formatCount(graph.nodes.filter((n) => n.kind === kind).length, locale);
    }
    const undeclared = graph.nodes.filter((n) => n.kind === "model" && n.undeclared.length > 0);
    return (
      <aside aria-labelledby={headId} className="lineage-detail">
        <h2 className="label" id={headId}>
          {t("lineage.detailHead")}
        </h2>
        <p className="prose prose--quiet">{t("lineage.detailNone")}</p>
        <dl className="lineage-facts">
          <dt>{t("lineage.factModels")}</dt>
          <dd>{count("model")}</dd>
          <dt>{t("lineage.factRaw")}</dt>
          <dd>{count("raw")}</dd>
          <dt>{t("lineage.factMissing")}</dt>
          <dd>{count("missing")}</dd>
          <dt>{t("lineage.factUndeclared")}</dt>
          <dd>{formatCount(undeclared.length, locale)}</dd>
        </dl>
      </aside>
    );
  }

  const where = stateWord(t, nodeState(focus, node.id));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return (
    <aside aria-labelledby={headId} className="lineage-detail">
      <div className="lineage-detail__head">
        <span className="label">
          {kindWord(t, node)}
          {where === null ? null : ` · ${where}`}
        </span>
        <h2 className="lineage-detail__name" id={headId}>
          {node.name}
        </h2>
        <button
          className="plate plate--small"
          onClick={(): void => {
            select(null);
          }}
          type="button"
        >
          {t("lineage.clear")}
        </button>
      </div>

      {node.kind === "model" ? (
        <ModelFacts item={builds.get(node.name)} name={node.name} tenantId={tenantId} />
      ) : null}
      {node.kind === "raw" ? (
        <>
          <p className="prose">{t("lineage.rawTableLong")}</p>
          <Link className="plate plate--small" to={divisionPath("lake", tenantId)}>
            {t("lineage.openLake")}
          </Link>
        </>
      ) : null}
      {node.kind === "missing" ? <p className="note">{t("lineage.missingLong")}</p> : null}

      <dl className="lineage-facts">
        <dt>{t("lineage.factUpstream")}</dt>
        <dd>{formatCount((focus.chain?.size ?? 1) - 1, locale)}</dd>
        <dt>{t("lineage.factDownstream")}</dt>
        <dd>{formatCount((focus.downstream?.size ?? 1) - 1, locale)}</dd>
      </dl>

      <Neighbours
        byId={byId}
        edges={parentsOf(graph, node.id)}
        empty={node.kind === "model" ? t("lineage.readsNothing") : null}
        end="from"
        head={t("lineage.readsHead")}
        select={select}
      />
      <Neighbours
        byId={byId}
        edges={childrenOf(graph, node.id)}
        empty={t("lineage.readByNothing")}
        end="to"
        head={t("lineage.readByHead")}
        select={select}
      />

      {node.kind === "model" && node.undeclared.length > 0 ? (
        <section className="stack stack--tight">
          <h3 className="label">{t("lineage.undeclared")}</h3>
          <ul className="note">
            {node.undeclared.map((reason) => (
              <li key={`${reason.code}|${reason.subject ?? ""}|${reason.via ?? ""}`}>
                {reasonText(t, reason)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}

/** A node's neighbours on one side, each a press away from being the selection. */
function Neighbours({
  head,
  edges,
  end,
  byId,
  empty,
  select,
}: {
  head: string;
  edges: readonly Edge[];
  end: "from" | "to";
  byId: ReadonlyMap<string, LineageNode>;
  /** What to say when there are none; `null` says nothing, for a node that reads by nature. */
  empty: string | null;
  select: (name: string) => void;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (edges.length === 0 && empty === null) {
    return null;
  }
  return (
    <section className="stack stack--tight">
      <h3 className="label">{head}</h3>
      {edges.length === 0 ? (
        <p className="datum datum--quiet">{empty}</p>
      ) : (
        <ul className="lineage-detail__list">
          {edges.map((edge) => {
            const id = edge[end];
            const name = byId.get(id)?.name ?? id;
            return (
              <li key={id}>
                <button
                  className="lineage-detail__link"
                  onClick={(): void => {
                    select(name);
                  }}
                  type="button"
                >
                  {name}
                </button>
                {edge.via === null ? null : (
                  <span className="datum datum--quiet">{t("lineage.via", { via: edge.via })}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** A model's own facts: its last build, the columns it produced, and its SQL. */
function ModelFacts({
  name,
  item,
  tenantId,
}: {
  name: string;
  item: ModelItem | undefined;
  tenantId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const model = trpc.models.get.useQuery({ tenantId, name });
  const built = item?.lastBuild ?? null;
  const status = built?.status ?? null;

  return (
    <>
      <dl className="lineage-facts">
        <dt>{t("lineage.factBuild")}</dt>
        <dd>
          {item === undefined ? null : (
            <StatusMark label={buildMarkLabel(t, status)} mark={buildMark(status)} />
          )}
          {built === null || built.endedAt === null ? null : (
            <span className="datum datum--quiet">{formatDateTime(built.endedAt, locale)}</span>
          )}
        </dd>
        {item === undefined ? null : (
          <>
            <dt>{t("lineage.factUpdated")}</dt>
            <dd className="datum">{relativeTime(item.updatedAt, locale)}</dd>
          </>
        )}
      </dl>
      <div className="row">
        <Link className="plate plate--small" to={`${divisionPath("models", tenantId)}/${name}`}>
          {t("lineage.openEditor")}
        </Link>
        {built === null ? null : (
          <Link
            className="plate plate--small"
            to={`${divisionPath("journal", tenantId)}/${built.runId}`}
          >
            {t("lineage.openRun")}
          </Link>
        )}
      </div>

      <section className="stack stack--tight">
        <h3 className="label">
          {built === null
            ? t("lineage.columnsHead")
            : t("lineage.columnsCounted", { count: built.columns.length })}
        </h3>
        {built === null ? (
          <p className="datum datum--quiet">{t("lineage.columnsUnknown")}</p>
        ) : (
          <ul className="lineage-schema">
            {built.columns.map((column) => (
              <li key={column}>{column}</li>
            ))}
          </ul>
        )}
      </section>

      <details className="lineage-detail__sql">
        <summary className="label">{t("lineage.sqlHead")}</summary>
        {model.isPending ? <Skeleton rows={3} /> : null}
        {model.isError ? <Errata heading={t("common.notLoaded")} error={model.error} /> : null}
        {model.isSuccess && model.data !== null ? (
          <pre className="payload__text">{model.data.sql}</pre>
        ) : null}
      </details>
    </>
  );
}
