/**
 * The raw lake division: what has actually landed.
 *
 * The index is for everyone: what landed, per stream, as counts and instants, because "did
 * anything come in" is a question every member of a customer is entitled to have answered.
 * Everything under it is for an admin -- the rows themselves, which for a CRM are names and
 * for a mailbox are whatever the mail said. The server refuses those to anyone else; hiding
 * them here is courtesy, and the honest rendering of what the reader may do.
 *
 * THE CONSOLE IS A DOOR ON THIS LEAF RATHER THAN A BAND ON IT. It used to be the fourth
 * band, and a band is as tall as the page has left over: an editor too short to write a join
 * in over a grid too short to read the answer in. It has its own page now (`routes/LakeQuery`),
 * and the plate that opens it carries whichever stream this index has open, so the gesture
 * that used to end in a seeded editor three bands down still ends in that stream's rows.
 *
 * The browser and the search are their own chunks, loaded only when an admin opens this
 * leaf: a member reading a count never downloads the code that pages through payloads.
 */

import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { Errata } from "@/components/Errata.tsx";
import { ArrowRight } from "@/components/Icon.tsx";
import { LakeSummary } from "@/components/LakeSummary.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { consolePath, type LakeStream, parseStream, streamParams, streamsOf } from "@/lib/lake.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const LakeBrowser = lazy(() =>
  import("@/components/LakeBrowser.tsx").then((module) => ({ default: module.LakeBrowser })),
);

// Its own chunk, for the same reason: the fold table is a hundred characters a member never needs.
const LakeSearch = lazy(() =>
  import("@/components/LakeSearch.tsx").then((module) => ({ default: module.LakeSearch })),
);

export function Lake({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [params] = useSearchParams();
  const summary = trpc.lake.summary.useQuery({ tenantId });
  const tenant = trpc.tenants.get.useQuery({ tenantId });
  // When the first run comes, for the empty leaf, and which mailbox a stream came from, for a
  // tenant with more than one. Cached from the Sources leaf.
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
            <p className="prose">{t("lake.consoleLead")}</p>
            {/* A DOOR, NOT A WORKSPACE. The console used to be this band, and a band is as
                tall as the leaf has left over -- which here was an editor too short to write
                a join in over a grid too short to read the answer in. It has its own page
                now, and it carries the stream this index has open, so the press that opened
                a line still ends in that line's rows rather than in an empty editor. */}
            <div className="row">
              <Link className="plate plate--primary" to={consolePath(tenantId, open)}>
                {t("lake.consoleOpen")}
                <ArrowRight />
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
