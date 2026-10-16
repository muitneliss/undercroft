/**
 * The one question a dashboard tile can be added from, while editing (`TilesBand` in
 * `DashboardBands.tsx`). Its own file because it is a form of its own, with nothing of the
 * grid's but the questions it is handed.
 */

import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { QuestionView } from "@/api/types.ts";

/**
 * The one question a tile can be added from, while editing.
 *
 * Only questions not already on the grid are offered: a dashboard cannot hold the same
 * question twice, and offering one that would be refused is a press that goes nowhere. The
 * select is keyed by its options, so adding one re-renders rather than leaving the entry
 * that was just removed still selected.
 */
export function AddTileForm({
  questions,
  addable,
  onAdd,
}: {
  questions: readonly QuestionView[];
  addable: readonly QuestionView[];
  onAdd: (questionId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const dAddId = useId();

  if (questions.length === 0) {
    return <p className="note">{t("dashboard.noQuestionsYet")}</p>;
  }
  if (addable.length === 0) {
    return <p className="note">{t("dashboard.noneToAdd")}</p>;
  }

  return (
    <form
      className="row row--field"
      onSubmit={(event): void => {
        event.preventDefault();
        const chosen = String(new FormData(event.currentTarget).get("question") ?? "");
        if (addable.some((question) => question.id === chosen)) {
          onAdd(chosen);
        }
      }}
    >
      <div className="field">
        <label className="label" htmlFor={dAddId}>
          {t("dashboard.addQuestion")}
        </label>
        <select
          className="input input--select"
          id={dAddId}
          key={addable.map((question) => question.id).join(",")}
          name="question"
        >
          {addable.map((question) => (
            <option key={question.id} value={question.id}>
              {question.name}
            </option>
          ))}
        </select>
      </div>
      <button className="plate" type="submit">
        {t("dashboard.add")}
      </button>
    </form>
  );
}
