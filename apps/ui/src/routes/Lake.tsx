/**
 * The raw lake division: what has actually landed.
 *
 * The index first -- what landed, per stream, as counts and instants -- and under it the rows
 * themselves, which for a CRM are names and for a mailbox are whatever the mail said. All of it
 * is `lake:read`'s, the summary included since ADR 0146, so the division `requires` it and `Book`
 * never mounts this leaf for a reader without it: there is no lesser Lake to draw for them.
 *
 * THE CONSOLE IS A DOOR ON THIS LEAF RATHER THAN A BAND ON IT. It used to be the fourth
 * band, and a band is as tall as the page has left over: an editor too short to write a join
 * in over a grid too short to read the answer in. It has its own page now (`routes/LakeQuery`),
 * and the plate that opens it carries whichever stream this index has open, so the gesture
 * that used to end in a seeded editor three bands down still ends in that stream's rows.
 *
 * The browser and the search are their own chunks, loaded only once there is something landed
 * to page through: a customer with an empty lake never downloads the code that reads payloads.
 */

import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { Errata } from "@/components/Errata.tsx";
import { ArrowRight } from "@/components/Icon.tsx";
import { LakeSummary } from "@/components/LakeSummary.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { useAccounts } from "@/components/useAccounts.ts";
import { kindsPath } from "@/lib/documentKinds.ts";
import { consolePath, type LakeStream, parseStream, streamParams, streamsOf } from "@/lib/lake.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const LakeBrowser = lazy(() =>
  import("@/components/LakeBrowser.tsx").then((module) => ({ default: module.LakeBrowser })),
);

// Its own chunk, for the same reason: the fold table is a hundred characters an empty lake never needs.
const LakeSearch = lazy(() =>
  import("@/components/LakeSearch.tsx").then((module) => ({ default: module.LakeSearch })),
);

export function Lake({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [params] = useSearchParams();
  const summary = trpc.lake.summary.useQuery({ tenantId });
  // When the first run comes, for the empty leaf, and which mailbox a stream came from, for a
  // tenant with more than one -- for a reader who may read the sources (`useAccounts`).
  const accounts = useAccounts(tenantId);

  if (summary.isPending) {
    return <Skeleton rows={5} />;
  }
  if (summary.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("lake.notLoaded", { tenantId })}
      </Errata>
    );
  }

  const streams = streamsOf(summary.data);
  const open = parseStream(params);

  return (
    <div className="sheet">
      <div className="head head--division" aria-hidden="true">
        {t("lake.head")}
      </div>
      <div className="body stack">
        <LakeSummary
          tenantId={tenantId}
          summary={summary.data}
          connections={accounts}
          locale={locale}
          openStream={open}
          // The index doubles as the way in to each stream's rows.
          hrefFor={(stream: LakeStream): string =>
            `?${new URLSearchParams(streamParams(stream)).toString()}`
          }
        />
      </div>

      <div className="band-rule" />
      <h2 className="head">{t("lake.kindsHead")}</h2>
      <div className="body stack">
        <p className="prose">{t("lake.kindsLead", { tenantId })}</p>
        {/* A door, as the console's is: the catalogue is a page of this division, readable by
            whoever reads the division (ADR 0146), so it is offered over an empty lake too. */}
        <div className="row">
          <Link className="plate" to={kindsPath(tenantId)}>
            {t("lake.kindsOpen")}
            <ArrowRight />
          </Link>
        </div>
      </div>

      {streams.length > 0 ? (
        <>
          <div className="band-rule" />
          <h2 className="head">{t("lake.browserHead")}</h2>
          <div className="body stack">
            <Suspense fallback={<Skeleton rows={4} />}>
              <LakeBrowser tenantId={tenantId} />
            </Suspense>
          </div>

          <div className="band-rule" />
          <h2 className="head">{t("lake.searchHead")}</h2>
          <div className="body stack">
            <Suspense fallback={<Skeleton rows={3} />}>
              <LakeSearch tenantId={tenantId} />
            </Suspense>
          </div>

          <div className="band-rule" />
          <h2 className="head">{t("lake.consoleHead")}</h2>
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
