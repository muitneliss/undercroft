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

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/correctness/noUnresolvedImports: Biome's resolver does not see `Suspense` and `lazy` in @types/react 19, which declares them inside the `React` namespace it re-exports; `tsc` resolves them and so does the bundler, and both are in the gate.
// biome-ignore-all lint/nursery/noInlineStyles: Data becoming a style: the tile's grid placement IS the layout the author saved, four integers per tile that no class can carry. Biome's fix deletes the attribute rather than relocating it, which removes the feature.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks whose inferred type is a React shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- React's event handlers -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/performance/noJsxPropsBind: Inline handlers and the placement object on a tile. The re-render the rule is about needs a memoised child to bite; these props land on plain DOM elements.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noNestedTernary: Four chained conditions that map one tile onto its states -- gone, waiting, loading, refused, drawn -- and written as nested if/else they occupy twenty lines to say the same thing.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { compile, type DashboardTile, paramNames } from "@undercroft/contracts/bi";
import type { Locale } from "@undercroft/core/locale";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { QuestionView } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { TILE_ACTIONS, type TileAction } from "@/lib/dashboardLayout.ts";
import { divisionPath } from "@/lib/divisions.ts";
import { paramsFromSearch } from "@/lib/params.ts";
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
          onClick={() => {
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
  const names = question === null ? [] : paramNames(compile(question.definition));
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
      <div className="grid__head">
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
      </div>
      <div className="grid__body">
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
      </div>
    </section>
  );
}
