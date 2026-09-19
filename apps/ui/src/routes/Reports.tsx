/**
 * The reports division: questions, charts and dashboards over the customer's models.
 *
 * An unprinted leaf until the first question can be asked. The division exists now for the
 * reason `Models.tsx` gives: the wheel was filled in one decision (ADR 0019).
 */

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/EmptyState.tsx";

export function Reports({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="sheet">
      <div className="head head--division">{t("reports.head")}</div>
      <div className="body stack">
        <h1>{t("reports.title")}</h1>
        <p className="prose prose--lead">{t("reports.lead", { tenantId })}</p>
        <EmptyState title={t("reports.emptyTitle")} body={t("reports.emptyBody")} />
      </div>
    </div>
  );
}
