/**
 * What the person or role a grant is for can see now (ADR 0143), from `scopes.preview`: how many
 * of the customer's models they read, and for each one they read only part of, which rows, which
 * columns are hidden, and whether its row rule is broken -- which shows them none of its rows.
 *
 * Read before the grant and refreshed after it, so the reader sees what their grant did. The
 * answer is the server's; nothing here works out who sees what.
 */

import { useTranslation } from "react-i18next";

import { subjectOf } from "@/lib/grantChoices.ts";
import { rowsWords } from "@/lib/grantRules.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** Why a row rule is broken, one sentence each: every one shows that reader no row of the table. */
const BROKEN = {
  "column-missing": "scopePreview.brokenColumn",
  "value-type": "scopePreview.brokenValue",
  "not-a-table": "scopePreview.brokenNotTable",
} as const;

export function ScopePreview({
  tenantId,
  subject,
}: {
  tenantId: string;
  /** The subject select's value: `role:<key>` or `email:<address>`. */
  subject: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const named = subjectOf(subject);
  const preview = trpc.scopes.preview.useQuery(
    { tenantId, ...(named ?? {}) },
    { enabled: named !== null },
  );
  if (named === null || preview.data === undefined) {
    return null;
  }
  const { models } = preview.data;
  const narrowed = models.reached.filter((model) => model.rows !== null || model.hidden.length > 0);
  return (
    <section aria-label={t("scopePreview.label")} className="stack stack--tight">
      <span className="label">{t("scopePreview.head")}</span>
      <p className="note">
        {models.whole
          ? t("scopePreview.everyModel", { count: models.total })
          : t("scopePreview.someModels", { count: models.reached.length, total: models.total })}
      </p>
      {narrowed.map((model) => (
        <p className="note" key={model.name}>
          {model.broken === null
            ? t("scopePreview.limited", {
                model: model.name,
                rows: rowsWords(t, locale, model.rows),
                hidden:
                  model.hidden.length === 0
                    ? t("scopePreview.noneHidden")
                    : model.hidden.join(", "),
              })
            : t(BROKEN[model.broken.fault], {
                model: model.name,
                columns: model.broken.columns.join(", "),
              })}
        </p>
      ))}
      {narrowed.some((model) => model.hidden.length > 0) ? (
        <p className="field__hint">{t("scopePreview.newColumns")}</p>
      ) : null}
    </section>
  );
}
