/**
 * The raw lake division: what has actually landed.
 *
 * Two bands. The first is for everyone: what landed, per stream, as counts and instants,
 * because "did anything come in" is a question every member of a customer is entitled to
 * have answered. The second is for an admin: the rows themselves, which for a CRM are names
 * and for a mailbox are whatever the mail said. The server refuses the second to anyone
 * else; hiding it here is courtesy, and the honest rendering of what they may do.
 *
 * The browser is its own chunk, loaded only when an admin opens this leaf: a member reading
 * a count never downloads the code that pages through payloads.
 */

import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import { LakeSummary } from "@/components/LakeSummary.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { streamsOf } from "@/lib/lake.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const LakeBrowser = lazy(() =>
  import("@/components/LakeBrowser.tsx").then((module) => ({ default: module.LakeBrowser })),
);

export function Lake({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const summary = trpc.lake.summary.useQuery({ tenantId });
  const tenant = trpc.tenants.get.useQuery({ tenantId });
  // For the empty leaf only: when the first run comes. Cached from the Sources leaf.
  const connections = trpc.connections.list.useQuery({ tenantId });

  if (summary.isPending || tenant.isPending) {
    return <Skeleton rows={5} />;
  }
  if (summary.isError || tenant.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("lake.notLoaded", { tenantId })}
      </Errata>
    );
  }

  const isAdmin = tenant.data.role === "admin";
  const streams = streamsOf(summary.data);

  return (
    <div className="sheet">
      <div className="head head--division">{t("lake.head")}</div>
      <div className="body stack">
        <LakeSummary
          tenantId={tenantId}
          summary={summary.data}
          connections={connections.data ?? []}
          locale={locale}
        />
      </div>

      {isAdmin && streams.length > 0 ? (
        <>
          <div className="band-rule" />
          <div className="head">{t("lake.browserHead")}</div>
          <div className="body stack">
            <Suspense fallback={<Skeleton rows={4} />}>
              <LakeBrowser tenantId={tenantId} streams={streams} />
            </Suspense>
          </div>
        </>
      ) : null}
    </div>
  );
}
