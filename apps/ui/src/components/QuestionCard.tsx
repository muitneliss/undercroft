/**
 * One tile on a dashboard: a saved question, answered under the dashboard's filters and
 * drawn as it was saved to be drawn.
 *
 * The answer is a READ through the query cache, keyed on the bound parameters, so every
 * tile refetches once when a filter changes and a return to the dashboard costs nothing. A
 * tile whose question names a parameter the filters do not fill says which, and runs
 * nothing -- a chart drawn over a guessed value looks exactly like a chart. A tile whose
 * question was deleted says so rather than vanishing, as the delete copy promised.
 *
 * The title opens the question on the dashboard's current values for every parameter it
 * takes, with the way back to the dashboard as it stands (`lib/reportLinks.ts`), so the
 * reader who follows it runs the same figures with nothing re-entered.
 *
 * Its foot names the model table a question built in the form reads, and opens the same
 * question on its rows ("View data"). A question written as SQL names no table: which tables
 * a SQL text reads is not declared anywhere, and parsing it for one would be a guess drawn as
 * a fact (ADR 0092). The table links to its model; every role may read Models (`models.get`
 * is a tenant read), so the link is offered to a viewer too.
 *
 * The tile places itself on the grid inline from the saved layout; in edit mode it carries
 * the nine controls that move and size it, one cell at a time.
 */

import type { DashboardTile } from "@undercroft/contracts/bi";
import type { Locale } from "@undercroft/core/locale";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import type { QuestionView } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { CardContent, CardFooter, CardHeader } from "@/components/ui/card.tsx";
import { TILE_ACTIONS, type TileAction } from "@/lib/dashboardLayout.ts";
import { divisionPath } from "@/lib/divisions.ts";
import { paramsFromSearch, questionParams } from "@/lib/params.ts";
import type { QuestionPane } from "@/lib/questionPane.ts";
import { tileQuestionHref } from "@/lib/reportLinks.ts";
import { trpc } from "@/trpc.ts";

// The charting library rides in its own chunk, fetched the first time a tile is drawn.
const ChartFrame = lazy(() =>
  import("@/components/charts/ChartFrame.tsx").then((module) => ({ default: module.ChartFrame })),
);

const ACTION_KEY = {
  left: "dashboard.moveLeft",
  right: "dashboard.moveRight",
  up: "dashboard.moveUp",
  down: "dashboard.moveDown",
  wider: "dashboard.wider",
  narrower: "dashboard.narrower",
  taller: "dashboard.taller",
  shorter: "dashboard.shorter",
  remove: "dashboard.removeTile",
} as const;

/** The glyph on each control; its words are the `aria-label`. */
const ACTION_GLYPH: Record<TileAction, string> = {
  left: "←",
  right: "→",
  up: "↑",
  down: "↓",
  wider: "W+",
  narrower: "W−",
  taller: "H+",
  shorter: "H−",
  remove: "×",
};

function TileControls({ onAction }: { onAction: (action: TileAction) => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="grid__controls">
      {TILE_ACTIONS.map((action) => (
        <button
          key={action}
          aria-label={t(ACTION_KEY[action])}
          className="plate plate--small"
          title={t(ACTION_KEY[action])}
          type="button"
          onClick={(): void => {
            onAction(action);
          }}
        >
          {ACTION_GLYPH[action]}
        </button>
      ))}
    </div>
  );
}

/** The model table a question reads, when its definition declares one, and the way to its rows. */
function TileFoot({
  tenantId,
  question,
  dataHref,
}: {
  tenantId: string;
  question: QuestionView;
  dataHref: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const table = question.definition.kind === "visual" ? question.definition.table : null;

  return (
    <CardFooter className="grid__foot">
      {table === null ? (
        <span />
      ) : (
        <Link
          className="datum datum--quiet"
          to={`${divisionPath("models", tenantId)}/${encodeURIComponent(table)}`}
        >
          {table}
        </Link>
      )}
      <Link className="print-omit" to={dataHref}>
        {t("dashboard.viewData")}
      </Link>
    </CardFooter>
  );
}

/**
 * A tile's answer: what it waits for, the answer being read, the refusal, or the drawing.
 * Read through the query cache keyed on the bound values, so a filter change refetches once.
 */
function TileBody({
  tenantId,
  question,
  names,
  search,
  locale,
}: {
  tenantId: string;
  question: QuestionView;
  names: readonly string[];
  search: URLSearchParams;
  locale: Locale;
}): React.JSX.Element {
  const { t } = useTranslation();
  const bound = paramsFromSearch(search, names);
  const answer = trpc.bi.questions.answer.useQuery(
    { tenantId, id: question.id, params: bound.params },
    { enabled: bound.missing.length === 0 },
  );

  if (bound.missing.length > 0) {
    return (
      <p className="note">
        {t("dashboard.waiting", { count: bound.missing.length, names: bound.missing.join(", ") })}
      </p>
    );
  }
  if (answer.isPending) {
    return <Skeleton rows={3} />;
  }
  if (answer.isError) {
    return <Errata heading={t("bi.notRun")} error={answer.error} />;
  }
  return (
    <Suspense fallback={<Skeleton rows={3} />}>
      <ChartFrame result={answer.data} chart={question.chart} locale={locale} />
    </Suspense>
  );
}

export function QuestionCard({
  tenantId,
  tile,
  question,
  search,
  locale,
  edit,
  onAction,
}: {
  tenantId: string;
  tile: DashboardTile;
  /** Null when the question the tile names no longer exists. */
  question: QuestionView | null;
  search: URLSearchParams;
  locale: Locale;
  edit: boolean;
  onAction: (action: TileAction) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const names = question === null ? [] : questionParams(question.definition);
  function questionHref(id: string, pane?: QuestionPane): string {
    return tileQuestionHref({
      questionPath: `${divisionPath("reports", tenantId)}/questions/${id}`,
      names,
      dashboardPath: pathname,
      search,
      ...(pane === undefined ? {} : { pane }),
    });
  }

  return (
    <section
      aria-label={question === null ? t("dashboard.questionGone") : question.name}
      className="grid__tile"
      style={{
        gridColumn: `${String(tile.x + 1)} / span ${String(tile.w)}`,
        gridRow: `${String(tile.y + 1)} / span ${String(tile.h)}`,
      }}
    >
      <CardHeader className="grid__head">
        {question === null ? (
          <span className="label">{t("dashboard.questionGone")}</span>
        ) : (
          <Link className="label" to={questionHref(question.id)}>
            {question.name}
          </Link>
        )}
        {edit ? <TileControls onAction={onAction} /> : null}
      </CardHeader>
      <CardContent className="grid__body">
        {question === null ? null : (
          <TileBody
            tenantId={tenantId}
            question={question}
            names={names}
            search={search}
            locale={locale}
          />
        )}
      </CardContent>
      {question === null ? null : (
        <TileFoot
          tenantId={tenantId}
          question={question}
          dataHref={questionHref(question.id, "data")}
        />
      )}
    </section>
  );
}
