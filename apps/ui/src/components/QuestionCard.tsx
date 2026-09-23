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
 * The tile places itself on the grid inline from the saved layout; in edit mode it carries
 * the nine controls that move and size it, one cell at a time.
 */

import type { DashboardTile } from "@undercroft/contracts/bi";
import type { Locale } from "@undercroft/core/locale";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { QuestionView } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { CardContent, CardHeader } from "@/components/ui/card.tsx";
import { TILE_ACTIONS, type TileAction } from "@/lib/dashboardLayout.ts";
import { divisionPath } from "@/lib/divisions.ts";
import { paramsFromSearch, questionParams } from "@/lib/params.ts";
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
  const names = question === null ? [] : questionParams(question.definition);
  const bound = paramsFromSearch(search, names);
  const answer = trpc.bi.questions.answer.useQuery(
    { tenantId, id: tile.questionId, params: bound.params },
    { enabled: question !== null && bound.missing.length === 0 },
  );

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
          <Link
            className="label"
            to={`${divisionPath("reports", tenantId)}/questions/${question.id}`}
          >
            {question.name}
          </Link>
        )}
        {edit ? <TileControls onAction={onAction} /> : null}
      </CardHeader>
      <CardContent className="grid__body">
        {question === null ? null : bound.missing.length > 0 ? (
          <p className="note">
            {t("dashboard.waiting", {
              count: bound.missing.length,
              names: bound.missing.join(", "),
            })}
          </p>
        ) : answer.isPending ? (
          <Skeleton rows={3} />
        ) : answer.isError ? (
          <Errata heading={t("bi.notRun")}>{answer.error.message}</Errata>
        ) : (
          <Suspense fallback={<Skeleton rows={3} />}>
            <ChartFrame result={answer.data} chart={question.chart} locale={locale} />
          </Suspense>
        )}
      </CardContent>
    </section>
  );
}
