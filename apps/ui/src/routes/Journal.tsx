/**
 * The journal division: every run of one customer's data, newest first.
 *
 * This is the page that answers "did it work". The card on the Sources leaf says what the
 * newest run did; this says what every run did, and opens any of them in its own row. The
 * ledger it reads is the same `ops.run` the worker writes, so a run that landed nothing is
 * still a line here and a run that failed is a line that says why.
 *
 * The open run lives in the URL (`/journal/:runId`), not in the store: a run's detail is a
 * thing an operator pastes to a colleague mid-call, and a reload must land on the same row.
 * Pages come from the query cache as an infinite query keyed on the ledger's own cursor.
 * There is no `useState` and nothing here needs one.
 *
 * It polls while a run is in progress and only then -- the one state on this page that
 * changes without anybody pressing anything -- so pressing Run now on the Sources leaf and
 * switching here shows the mark flip when the run ends.
 */

import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { RunDetail } from "@/components/RunDetail.tsx";
import { RunRow } from "@/components/RunRow.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { journalEmptyBody } from "@/lib/runs.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const PAGE = 50;
/** How often the ledger re-reads while a run is in progress. A run is minutes; this is not. */
const RUNNING_POLL_MS = 5000;
/** The journal's columns, which the hinge row spans. */
const COLUMNS = 8;

export function Journal({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const params = useParams();
  const openId = params.runId ?? null;

  const runs = trpc.runs.list.useInfiniteQuery(
    { tenantId, limit: PAGE },
    {
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      refetchInterval: (query) =>
        query.state.data?.pages[0]?.items.some((run) => run.status === "running") === true
          ? RUNNING_POLL_MS
          : false,
    },
  );
  // For the empty state only: when the first run comes. Cached from the Sources leaf.
  const connections = trpc.connections.list.useQuery({ tenantId });

  if (runs.isPending) {
    return <Skeleton rows={6} />;
  }
  if (runs.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("journal.notLoaded", { tenantId })}
      </Errata>
    );
  }

  const items = runs.data.pages.flatMap((page) => page.items);
  const base = divisionPath("journal", tenantId);
  // A deep link to a run older than the pages loaded so far still opens it: the leaf is
  // drawn above the table rather than inside a row it cannot find.
  const openElsewhere = openId !== null && !items.some((run) => run.id === openId);

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.journal")}</div>
      <div className="body stack">
        <h1>{t("journal.title")}</h1>
        <p className="prose prose--lead">{t("journal.lead", { tenantId })}</p>

        {openElsewhere ? <RunDetail tenantId={tenantId} runId={openId} /> : null}

        {items.length === 0 ? (
          <EmptyState
            title={t("journal.emptyTitle")}
            body={journalEmptyBody(t, locale, connections.data ?? [])}
            action={
              <Link className="plate" to={divisionPath("sources", tenantId)}>
                {t("journal.goToSources")}
              </Link>
            }
          />
        ) : (
          <RunTable items={items} tenantId={tenantId} openId={openId} base={base} />
        )}

        {runs.hasNextPage ? (
          <div className="row">
            <button
              className="plate"
              type="button"
              disabled={runs.isFetchingNextPage}
              onClick={(): void => {
                void runs.fetchNextPage();
              }}
            >
              {t("journal.older")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type Run = React.ComponentProps<typeof RunRow>["run"];

/**
 * The ledger itself: one row per run, and the open one's detail on a hinge row beneath it.
 *
 * Its own component because the eight columns are the bulk of this page and none of them is
 * a decision -- the decisions (which run is open, whether there is another page) stay above.
 */
function RunTable({
  items,
  tenantId,
  openId,
  base,
}: {
  items: readonly Run[];
  tenantId: string;
  openId: string | null;
  base: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  // Which mailbox a run read, for a tenant with more than one (`sourceLabel`). The same cached
  // query the page above already made, so asking for it here costs no request.
  const accounts = trpc.connections.list.useQuery({ tenantId }).data ?? [];

  return (
    <table className="table">
      <caption>{t("journal.caption", { count: items.length })}</caption>
      <thead>
        <tr>
          <th scope="col">{t("journal.colWhen")}</th>
          <th scope="col">{t("journal.colWhat")}</th>
          <th scope="col">{t("journal.colOutcome")}</th>
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
            {t("journal.colRefused")}
          </th>
          <th scope="col" className="num">
            {t("journal.colDuration")}
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((run) => (
          <Fragment key={run.id}>
            <RunRow
              run={run}
              locale={locale}
              open={run.id === openId}
              href={`${base}/${run.id}`}
              accounts={accounts}
            />
            {run.id === openId ? (
              <tr className="table__hinge">
                <td colSpan={COLUMNS}>
                  <RunDetail tenantId={tenantId} runId={run.id} />
                </td>
              </tr>
            ) : null}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
