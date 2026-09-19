/**
 * One run in full, on a leaf hinged open inside its own row of the journal.
 *
 * Never a modal, for the reason `.hinge` gives: the rows above and below stay in the
 * document, in the tab order and on screen, so a reader comparing two runs is comparing
 * two lines of one table rather than two dialogs.
 *
 * What it shows is what the ledger recorded and nothing it did not: the counts per entity,
 * the run's own error in an errata slip, every record the run refused with its reason, and
 * every dbt step with its failing-row count. A section with nothing in it is not drawn --
 * an empty refusals table would say "refusals" over a run that refused nothing -- and a run
 * that recorded nothing beyond its outcome says so in one line.
 */

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as the routes: what remains are contextually-typed callbacks whose inferred type is a React or tRPC shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- React's event handlers, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { useTranslation } from "react-i18next";

import { Errata } from "@/components/Errata.tsx";
import { RunEvents } from "@/components/RunEvents.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { StepsTable } from "@/components/StepsTable.tsx";
import { formatCount, orMissing } from "@/lib/money.ts";
import { triggerLabel } from "@/lib/runs.ts";
import { formatDateTime, formatDuration } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** How often the leaf re-reads a run still in progress. */
const RUNNING_POLL_MS = 5000;

/**
 * How often the feed re-reads while a run is live.
 *
 * Faster than the detail beside it, because this is the part a person is watching. Not
 * faster than two seconds: the worker coalesces its own progress lines at that interval, so
 * reading more often than it writes would buy nothing.
 */
const LIVE_POLL_MS = 2000;

export function RunDetail({
  tenantId,
  runId,
}: {
  tenantId: string;
  runId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const run = trpc.runs.get.useQuery(
    { tenantId, runId },
    {
      refetchInterval: (query) =>
        query.state.data?.status === "running" ? RUNNING_POLL_MS : false,
    },
  );
  // The feed is read on its own and faster: it is the part that changes while somebody is
  // watching, where the detail beside it only changes when the run ends.
  const running = run.data?.status === "running";
  const feed = trpc.runs.events.useQuery(
    { tenantId, runId },
    { refetchInterval: running ? LIVE_POLL_MS : false },
  );

  if (run.isPending) {
    return (
      <div className="hinge">
        <Skeleton rows={3} />
      </div>
    );
  }
  if (run.isError) {
    return (
      <div className="hinge">
        <Errata heading={t("common.notLoaded")} live={true}>
          {t("journal.detailNotLoaded")}
        </Errata>
      </div>
    );
  }

  const detail = run.data;
  const events = feed.data ?? [];
  const bare =
    detail.error === null &&
    detail.entityCounts.length === 0 &&
    detail.refusals.length === 0 &&
    detail.steps.length === 0 &&
    events.length === 0;

  return (
    <div className="hinge stack">
      <span className="hinge__punch hinge__punch--a" aria-hidden="true" />
      <span className="hinge__punch hinge__punch--b" aria-hidden="true" />

      <div className="row">
        <span className="stack stack--tight">
          <span className="label">{t("journal.started")}</span>
          <span className="datum">{formatDateTime(detail.startedAt, locale)}</span>
        </span>
        <span className="stack stack--tight">
          <span className="label">{t("journal.ended")}</span>
          <span className="datum">{formatDateTime(detail.endedAt, locale)}</span>
        </span>
        <span className="stack stack--tight">
          <span className="label">{t("journal.colDuration")}</span>
          <span className="datum">{formatDuration(detail.startedAt, detail.endedAt, locale)}</span>
        </span>
        <span className="stack stack--tight">
          <span className="label">{t("journal.trigger")}</span>
          <span className="datum">{triggerLabel(t, detail.trigger)}</span>
        </span>
        <span className="stack stack--tight">
          <span className="label">{t("journal.runId")}</span>
          <span className="datum datum--quiet">{detail.id}</span>
        </span>
      </div>

      {detail.error === null ? null : (
        <Errata heading={t("journal.errorHead")}>{detail.error}</Errata>
      )}

      {/* Above the counts, because while the run is going the counts are not there yet. */}
      {events.length > 0 ? <RunEvents events={events} locale={locale} live={running} /> : null}

      {detail.entityCounts.length > 0 ? (
        <table className="table">
          <caption>{t("journal.entitiesHead")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("journal.colEntity")}</th>
              <th scope="col" className="num">
                {t("journal.colLanded")}
              </th>
              <th scope="col" className="num">
                {t("journal.colCreated")}
              </th>
              <th scope="col" className="num">
                {t("journal.colChanged")}
              </th>
              <th scope="col" className="num">
                {t("journal.colUnchanged")}
              </th>
              <th scope="col" className="num">
                {t("journal.colRefused")}
              </th>
            </tr>
          </thead>
          <tbody>
            {detail.entityCounts.map((row) => (
              <tr key={row.entity}>
                <td className="datum">{row.entity}</td>
                <td className="num">{formatCount(row.landed, locale)}</td>
                <td className="num">{formatCount(row.created, locale)}</td>
                <td className="num">{formatCount(row.changed, locale)}</td>
                <td className="num">{formatCount(row.unchanged, locale)}</td>
                <td className="num">{formatCount(row.refused, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {detail.refusals.length > 0 ? (
        <table className="table">
          <caption>{t("journal.refusalsHead")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("journal.colEntity")}</th>
              <th scope="col">{t("journal.colRecordId")}</th>
              <th scope="col">{t("journal.colReason")}</th>
              <th scope="col">{t("journal.colAt")}</th>
            </tr>
          </thead>
          <tbody>
            {detail.refusals.map((refusal) => (
              <tr key={`${refusal.entity}/${refusal.sourceRecordId}/${refusal.at}`}>
                <td className="datum">{refusal.entity}</td>
                <td className="datum datum--quiet">{orMissing(refusal.sourceRecordId)}</td>
                <td>{refusal.reason}</td>
                <td className="datum datum--quiet">{formatDateTime(refusal.at, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {detail.steps.length > 0 ? <StepsTable steps={detail.steps} locale={locale} /> : null}

      {bare ? <p className="note">{t("journal.nothingRecorded")}</p> : null}
    </div>
  );
}
