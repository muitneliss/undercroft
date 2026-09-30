/**
 * The dashboard's tiles as a list in the order a reader meets them, while editing: move one
 * earlier or later, or take it off.
 *
 * The grid's own controls (`TileControls`) move a tile a cell at a time, which is how an
 * author sizes and places one. They are a poor way to answer the question an author actually
 * starts from -- which figure is read first -- and they cannot be followed by a keyboard
 * reader who cannot see the grid. This list answers that question in words, one row per
 * tile, beside the grid rather than instead of it.
 *
 * Reading order is where the tiles sit, so a move exchanges two tiles' places
 * (`moveInReadingOrder`). Every change writes the draft in the store, as the grid's controls
 * do; nothing is saved until Save.
 */

import type { DashboardLayout } from "@undercroft/contracts/bi";
import type { Locale } from "@undercroft/core/locale";
import { useTranslation } from "react-i18next";

import type { QuestionView } from "@/api/types.ts";
import { Separator } from "@/components/ui/separator.tsx";
import { inReadingOrder, moveInReadingOrder, removeTile } from "@/lib/dashboardLayout.ts";
import { formatCount } from "@/lib/money.ts";
import { useUiStore } from "@/store.ts";

/** Two digits, as a printed schedule numbers its entries. */
function place(index: number, locale: Locale): string {
  return formatCount(index + 1, locale).padStart(2, "0");
}

export function ReadingOrder({
  layout,
  questions,
  locale,
}: {
  layout: DashboardLayout;
  questions: readonly QuestionView[];
  locale: Locale;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const setDashboardLayout = useUiStore((state) => state.setDashboardLayout);
  const byId = new Map(questions.map((question) => [question.id, question.name]));
  const tiles = inReadingOrder(layout);

  if (tiles.length === 0) {
    return null;
  }

  return (
    <>
      <Separator className="band-rule" />
      <div className="head">{t("dashboard.orderHead")}</div>
      <div className="body stack">
        <p className="prose">{t("dashboard.orderLead")}</p>
        <table className="table">
          <caption>{t("dashboard.orderCaption", { count: tiles.length })}</caption>
          <thead>
            <tr>
              <th scope="col" className="num">
                {t("dashboard.orderPlace")}
              </th>
              <th scope="col">{t("bi.colName")}</th>
              <th scope="col">
                <span className="visually-hidden">{t("dashboard.edit")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tiles.map((tile, index) => {
              const name = byId.get(tile.questionId) ?? t("dashboard.questionGone");
              return (
                <tr key={tile.questionId}>
                  <td className="num datum">{place(index, locale)}</td>
                  <td>{name}</td>
                  <td>
                    <div className="row">
                      <button
                        aria-label={t("dashboard.orderEarlierNamed", { name })}
                        className="plate plate--small"
                        disabled={index === 0}
                        type="button"
                        onClick={(): void => {
                          setDashboardLayout(moveInReadingOrder(layout, tile.questionId, -1));
                        }}
                      >
                        {t("dashboard.orderEarlier")}
                      </button>
                      <button
                        aria-label={t("dashboard.orderLaterNamed", { name })}
                        className="plate plate--small"
                        disabled={index === tiles.length - 1}
                        type="button"
                        onClick={(): void => {
                          setDashboardLayout(moveInReadingOrder(layout, tile.questionId, 1));
                        }}
                      >
                        {t("dashboard.orderLater")}
                      </button>
                      <button
                        aria-label={t("dashboard.orderRemoveNamed", { name })}
                        className="plate plate--small"
                        type="button"
                        onClick={(): void => {
                          setDashboardLayout(removeTile(layout, tile.questionId));
                        }}
                      >
                        {t("dashboard.removeTile")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
