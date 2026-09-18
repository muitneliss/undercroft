/**
 * The sources division: the schedule of standing grants.
 *
 * The schedule IS the product — the screen a new customer lands on is the one an established
 * one uses. It reads the real grants from `trpc.connections.list`, whose query is also the
 * visibility boundary for this tenant.
 *
 * The connect / scope / disconnect / run actions the fuller design carries are not wired
 * here yet: the control-plane router exposes `connections.list` and `connections.startOAuth`
 * but no disconnect, no scope-config write, and no tenant-wide run — and the connection
 * record it returns is the thin `{ source, status }` shape, not the rich grant-health view
 * model those actions need. So this shows the grants honestly and says what is not yet
 * actionable, rather than rendering buttons that post nowhere.
 */

import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata";
import { Skeleton } from "@/components/Skeleton";
import { trpc } from "@/trpc";

export function TenantOverview({ tenantId }: { tenantId: string; scopeFor?: string }) {
  const { t } = useTranslation();
  const connections = trpc.connections.list.useQuery({ tenantId });

  if (connections.isPending) return <Skeleton rows={5} />;

  if (connections.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live>
        {t("sources.notLoaded")}
      </Errata>
    );
  }

  const list = connections.data;

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.sources")}</div>
      <div className="body stack">
        <h1>{t("sources.title")}</h1>
        <p className="prose prose--lead">
          {list.length === 0 ? t("sources.none") : t("sources.count", { count: list.length })}
        </p>
      </div>

      <div className="band-rule" />

      <div className="head">{t("sources.grantsHead")}</div>
      <div className="body">
        {list.length === 0 ? (
          <p className="note">{t("common.nothingToShow")}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("sources.colSource")}</th>
                <th scope="col">{t("sources.colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.source}>
                  <td>{c.source}</td>
                  <td className="datum datum--quiet">{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="note">{t("sources.notWired")}</p>
      </div>
    </div>
  );
}
