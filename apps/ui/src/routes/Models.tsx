/**
 * The models division: the customer's dbt models, written in the browser.
 *
 * An unprinted leaf until the editor lands. The division, its hue and its tab exist now
 * because the wheel was filled in one decision (ADR 0019), and a tab that appears later
 * would teach nobody that the section was coming.
 */

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/EmptyState.tsx";

export function Models({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="sheet">
      <div className="head head--division">{t("models.head")}</div>
      <div className="body stack">
        <h1>{t("models.title")}</h1>
        <p className="prose prose--lead">{t("models.lead", { tenantId })}</p>
        <EmptyState title={t("models.emptyTitle")} body={t("models.emptyBody")} />
      </div>
    </div>
  );
}
