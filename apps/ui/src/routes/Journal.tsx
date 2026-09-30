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
 * So does the account the ledger is narrowed to (`?source=`), which is what a source card opens
 * (ADR 0091) and what the account select above the table writes for a tenant with two accounts
 * or more: Back, Forward and a pasted link restore the same list, and the leaf says which
 * account it is showing and offers every run back.
 * Pages come from the query cache as an infinite query keyed on the ledger's own cursor.
 * There is no `useState` and nothing here needs one.
 *
 * It polls while a run is in progress and only then -- the one state on this page that
 * changes without anybody pressing anything -- so pressing Run now on the Sources leaf and
 * switching here shows the mark flip when the run ends.
 */

import { Fragment, useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { RunDetail } from "@/components/RunDetail.tsx";
import { RunRow } from "@/components/RunRow.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import {
  type AccountName,
  journalEmptyBody,
  journalPath,
  journalSource,
  sourceLabel,
} from "@/lib/runs.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const PAGE = 50;
/** How often the ledger re-reads while a run is in progress. A run is minutes; this is not. */
const RUNNING_POLL_MS = 5000;
/** The journal's columns, which the hinge row spans. */
const COLUMNS = 8;
/** How many connections a tenant holds before the ledger offers a choice between them. */
const ACCOUNTS_TO_CHOOSE = 2;

export function Journal({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const params = useParams();
  const openId = params.runId ?? null;
  const [search] = useSearchParams();
  const source = journalSource(search);

  const runs = trpc.runs.list.useInfiniteQuery(
    { tenantId, limit: PAGE, ...(source === null ? {} : { source }) },
    {
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      refetchInterval: (query) =>
        query.state.data?.pages[0]?.items.some((run) => run.status === "running") === true
          ? RUNNING_POLL_MS
          : false,
    },
  );
  // When the first run comes, for the empty state, and which mailbox a filtered source is, for
  // a tenant with two. Cached from the Sources leaf.
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
  const accounts = connections.data ?? [];
  // A deep link to a run older than the pages loaded so far still opens it: the leaf is
  // drawn above the table rather than inside a row it cannot find.
  const openElsewhere = openId !== null && !items.some((run) => run.id === openId);

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.journal")}</div>
      <div className="body stack">
        <h1>{t("journal.title")}</h1>
        <p className="prose prose--lead">{t("journal.lead", { tenantId })}</p>

        <LedgerFilter
          tenantId={tenantId}
          openId={openId}
          source={source}
          accounts={accounts}
          empty={items.length === 0}
        />

        {openElsewhere ? <RunDetail tenantId={tenantId} runId={openId} /> : null}

        {items.length === 0 && source === null ? (
          <NoRunsYet tenantId={tenantId} accounts={accounts} />
        ) : null}

        {items.length > 0 ? (
          <RunTable items={items} tenantId={tenantId} openId={openId} source={source} />
        ) : null}

        {runs.hasNextPage ? (
          <OlderRuns
            fetching={runs.isFetchingNextPage}
            onMore={(): void => {
              void runs.fetchNextPage();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** A tenant with no run at all: when the first one comes, and the way to the sources. */
function NoRunsYet({
  tenantId,
  accounts,
}: {
  tenantId: string;
  accounts: Parameters<typeof journalEmptyBody>[2];
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);

  return (
    <EmptyState
      title={t("journal.emptyTitle")}
      body={journalEmptyBody(t, locale, accounts)}
      action={
        <Link className="plate" to={divisionPath("sources", tenantId)}>
          {t("journal.goToSources")}
        </Link>
      }
    />
  );
}

/** The plate that reads the next page of the ledger, and says so while it does. */
function OlderRuns({
  fetching,
  onMore,
}: {
  fetching: boolean;
  onMore: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="row">
      <button className="plate" type="button" disabled={fetching} onClick={onMore}>
        {fetching ? t("journal.loadingOlder") : t("journal.older")}
      </button>
    </div>
  );
}

/**
 * Which account's runs the ledger reads: the choice of one, for a tenant with two or more, and
 * the statement of which one it is showing, with the way back to every run.
 *
 * One component for the two because they are one question -- the address's `?source=` -- and
 * the page above it only needs to know that the ledger can be narrowed, not how.
 */
function LedgerFilter({
  tenantId,
  openId,
  source,
  accounts,
  empty,
}: {
  tenantId: string;
  openId: string | null;
  source: string | null;
  accounts: readonly AccountName[];
  /** Whether the narrowed ledger holds no run at all. */
  empty: boolean;
}): React.JSX.Element {
  return (
    <>
      {accounts.length >= ACCOUNTS_TO_CHOOSE ? (
        <AccountSelect tenantId={tenantId} openId={openId} source={source} accounts={accounts} />
      ) : null}
      {source === null ? null : (
        <SourceFilter
          tenantId={tenantId}
          openId={openId}
          label={sourceLabel(source, accounts)}
          empty={empty}
        />
      )}
    </>
  );
}

/**
 * The choice of which account's runs the ledger reads, for a tenant with two or more.
 *
 * With one account, "every account" and "that account" are the same list, so the select is not
 * drawn at all rather than offered as a control that changes nothing. Choosing navigates: the
 * address stays the filter's only home (`?source=`, ADR 0091), and the open run stays open, as
 * it does when the filter is cleared. An account the address names that is no longer connected
 * is still an option, under the name the ledger gives it, so the select never reads "every
 * account" over a list narrowed to one.
 */
function AccountSelect({
  tenantId,
  openId,
  source,
  accounts,
}: {
  tenantId: string;
  openId: string | null;
  source: string | null;
  accounts: readonly AccountName[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selectId = useId();
  const connected = accounts.map((account) => account.source);
  const options =
    source === null || connected.includes(source) ? connected : [...connected, source];

  return (
    <div className="row row--field">
      <div className="field">
        <label className="label" htmlFor={selectId}>
          {t("journal.accountLabel")}
        </label>
        <select
          className="input input--select"
          id={selectId}
          value={source ?? ""}
          onChange={(event): void => {
            const chosen = event.target.value;
            void navigate(
              journalPath(tenantId, { source: chosen === "" ? null : chosen, runId: openId }),
            );
          }}
        >
          <option value="">{t("journal.allAccounts")}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {sourceLabel(option, accounts)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Which account the ledger is narrowed to, and the way back to every run.
 *
 * Said in words above the table rather than left in the address alone: a list that silently
 * held one account's runs would read as the tenant's whole history. Clearing keeps the open
 * run open, so the reader loses the filter and nothing else. An account with no runs says so
 * here, rather than under the tenant's empty state, whose "first run" sentence is about every
 * source at once.
 */
function SourceFilter({
  tenantId,
  openId,
  label,
  empty,
}: {
  tenantId: string;
  openId: string | null;
  /** The account as the ledger names it (`sourceLabel`). */
  label: string;
  empty: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <>
      <div className="row">
        <p className="note">{t("journal.filteredTo", { source: label })}</p>
        <Link className="plate plate--small" to={journalPath(tenantId, { runId: openId })}>
          {t("journal.showAllRuns")}
        </Link>
      </div>
      {empty ? <p className="note">{t("journal.filteredEmpty", { source: label })}</p> : null}
    </>
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
  source,
}: {
  items: readonly Run[];
  tenantId: string;
  openId: string | null;
  /** The account the ledger is narrowed to, which every row's link keeps. */
  source: string | null;
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
              href={journalPath(tenantId, { source, runId: run.id })}
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
