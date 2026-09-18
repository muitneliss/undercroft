/**
 * The raw lake division: what has actually landed.
 *
 * Browsing the raw lake — objects, their provenance manifests, and admin-only downloads —
 * needs endpoints the control-plane router does not expose yet, so this is an honest
 * placeholder in the design's idiom rather than a browser wired to nothing. It lands when
 * those procedures exist. The `tenantId` is accepted now so the route and tab rail are
 * already in place.
 */

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/EmptyState.tsx";

export function Lake({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="sheet">
      <div className="head head--division">{t("lake.head")}</div>
      <div className="body stack">
        <h1>{t("lake.title")}</h1>
        <p className="prose prose--lead">{t("lake.lead", { tenantId })}</p>
        <EmptyState title={t("lake.emptyTitle")} body={t("lake.emptyBody")} />
      </div>
    </div>
  );
}
