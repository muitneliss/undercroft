/**
 * A model's description on its own editor: a field an admin writes in, and to anyone else the
 * saved words as prose, or nothing at all when nobody described the model (ADR 0137).
 *
 * Optional and unchecked, on purpose. Nothing here asks for one, flags a model without one or
 * calls an empty field incomplete: ADR 0112 removed a feature that did, after it flagged every
 * model of the only tenant that had any. The text is the store's (`modelDraft.ts`), like the
 * SQL, so an author who leaves mid-edit comes back to it, and Save sends it with the SQL.
 */

import { MAX_MODEL_DESCRIPTION_CHARS } from "@undercroft/contracts/models";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { ModelDraft } from "@/lib/modelDraft.ts";
import { useUiStore } from "@/store.ts";

/** The lines the box shows before it scrolls: a sentence or two, as the hint asks for. */
const ROWS = 3;

export function ModelDescription({
  draft,
  canEdit,
}: {
  draft: ModelDraft;
  canEdit: boolean;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const fieldId = useId();
  const hintId = useId();
  const setModelDescription = useUiStore((state) => state.setModelDescription);

  if (!canEdit) {
    // What the server holds, not the draft: a reader who cannot save has no draft of their own.
    const saved = draft.saved.description;
    return saved === null ? null : <p className="prose">{saved}</p>;
  }
  return (
    <div className="field">
      <label className="label" htmlFor={fieldId}>
        {t("models.descriptionLabel")}
      </label>
      <textarea
        aria-describedby={hintId}
        className="input input--prose"
        id={fieldId}
        maxLength={MAX_MODEL_DESCRIPTION_CHARS}
        rows={ROWS}
        value={draft.description}
        onChange={(event): void => {
          setModelDescription(event.currentTarget.value);
        }}
      />
      <p className="field__hint" id={hintId}>
        {t("models.descriptionHint")}
      </p>
    </div>
  );
}
