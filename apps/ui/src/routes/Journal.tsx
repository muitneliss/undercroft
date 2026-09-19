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

// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Same functions as noExcessiveLinesPerFunction: one sequential procedure each, whose branches are the states the thing being driven can actually be in.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/complexity/noVoid: `void` here marks a promise deliberately not awaited, at the two places where that is correct and where dropping the marker would make it look like an oversight.
// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/correctness/noUnresolvedImports: Biome's resolver does not see `Fragment` in @types/react 19, which declares it inside the `React` namespace it re-exports; `tsc` resolves it and so does the bundler, and both are in the gate.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/performance/noJsxPropsBind: An inline handler on one plate. The re-render the rule is about matters under a memoised list of hundreds; this is one button.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

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
        )}

        {runs.hasNextPage ? (
          <div className="row">
            <button
              className="plate"
              type="button"
              disabled={runs.isFetchingNextPage}
              onClick={() => {
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
