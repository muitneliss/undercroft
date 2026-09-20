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
import { useSearchParams } from "react-router-dom";

import { Errata } from "@/components/Errata.tsx";
import { LakeSummary } from "@/components/LakeSummary.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { type LakeStream, parseStream, streamParams, streamsOf } from "@/lib/lake.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const LakeBrowser = lazy(() =>
  import("@/components/LakeBrowser.tsx").then((module) => ({ default: module.LakeBrowser })),
);

// Its own chunk: the editor and its SQL grammar. A member reading a count never downloads it.
const LakeConsole = lazy(() =>
  import("@/components/LakeConsole.tsx").then((module) => ({ default: module.LakeConsole })),
);

// And its own, for the same reason: the fold table is a hundred characters a member never needs.
const LakeSearch = lazy(() =>
  import("@/components/LakeSearch.tsx").then((module) => ({ default: module.LakeSearch })),
);

export function Lake({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [params] = useSearchParams();
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
  const open = parseStream(params);

  return (
    <div className="sheet">
      <div className="head head--division">{t("lake.head")}</div>
      <div className="body stack">
        <LakeSummary
          tenantId={tenantId}
          summary={summary.data}
          connections={connections.data ?? []}
          locale={locale}
          openStream={open}
          // The index doubles as the way in, but only for the reader the server would let
          // through. A member sees the same counts with no links: the facts are theirs, the
          // payload is not, and a link that answered 403 would be a promise this leaf breaks.
          {...(isAdmin
            ? {
                hrefFor: (stream: LakeStream): string =>
                  `?${new URLSearchParams(streamParams(stream)).toString()}`,
              }
            : {})}
        />
      </div>

      {isAdmin && streams.length > 0 ? (
        <>
          <div className="band-rule" />
          <div className="head">{t("lake.browserHead")}</div>
          <div className="body stack">
            <Suspense fallback={<Skeleton rows={4} />}>
              <LakeBrowser tenantId={tenantId} />
            </Suspense>
          </div>

          <div className="band-rule" />
          <div className="head">{t("lake.searchHead")}</div>
          <div className="body stack">
            <Suspense fallback={<Skeleton rows={3} />}>
              <LakeSearch tenantId={tenantId} />
            </Suspense>
          </div>

          <div className="band-rule" />
          <div className="head">{t("lake.consoleHead")}</div>
          <div className="body stack">
            <Suspense fallback={<Skeleton rows={6} />}>
              <LakeConsole tenantId={tenantId} locale={locale} />
            </Suspense>
          </div>
        </>
      ) : null}
    </div>
  );
}
