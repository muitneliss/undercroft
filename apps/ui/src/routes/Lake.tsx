/**
 * The raw lake division: what has actually landed.
 *
 * Browsing the raw lake — objects, their provenance manifests, and admin-only downloads —
 * needs endpoints the control-plane router does not expose yet, so this is an honest
 * placeholder in the design's idiom rather than a browser wired to nothing. It lands when
 * those procedures exist. The `tenantId` is accepted now so the route and tab rail are
 * already in place.
 */

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
