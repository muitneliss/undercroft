/**
 * The reports division: the customer's dashboards and questions, listed.
 *
 * A question is a query over the built models -- made in the builder or written as SQL --
 * and how it is drawn; a dashboard puts questions together under shared filters. Members
 * and admins author; a viewer reads what was made for them. The plate that starts a new
 * question is hidden from a viewer as courtesy; the server refuses regardless.
 *
 * One search finds either by name, accents ignored (`lib/reportSearch.ts`); the query lives
 * in the address, so a filtered list is a link. The two lists are two views of the division,
 * chosen in the address too (`?view=`), and each view's plate counts the names the search
 * matches in it, so a match in the list not shown is still visible. The time beside each is
 * when its DEFINITION
 * was last saved, and is named so: it says nothing about how fresh the data under it is,
 * and a column headed "Updated" was read as exactly that.
 */

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import type { DashboardItem, QuestionItem } from "@/api/types.ts";
import { ChartGlyph } from "@/components/ChartGlyph.tsx";
import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { formatCount } from "@/lib/money.ts";
import { byName, REPORT_QUERY } from "@/lib/reportSearch.ts";
import { relativeTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

import "@/styles/reports.css";

/** The search key the chosen list rides under. Dashboards are the default, and no key. */
const VIEW = "view";
const QUESTIONS_VIEW = "questions";

export function Reports({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const questions = trpc.bi.questions.list.useQuery({ tenantId });
  const dashboards = trpc.bi.dashboards.list.useQuery({ tenantId });
  const tenant = trpc.tenants.get.useQuery({ tenantId });

  if (questions.isPending || dashboards.isPending || tenant.isPending) {
    return <Skeleton rows={4} />;
  }
  if (questions.isError || dashboards.isError || tenant.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("reports.notLoaded", { tenantId })}
      </Errata>
    );
  }

  const canAuthor = tenant.data.role !== "viewer";
  const base = divisionPath("reports", tenantId);
  const nothing = questions.data.length === 0 && dashboards.data.length === 0;

  return (
    <div className="sheet">
      <div className="head head--division">{t("reports.head")}</div>
      <div className="body stack">
        <h1>{t("reports.title")}</h1>
        <p className="prose prose--lead">{t("reports.lead", { tenantId })}</p>
        {nothing ? (
          <EmptyState
            title={t("reports.emptyTitle")}
            body={canAuthor ? t("reports.emptyBody") : t("reports.emptyBodyViewer")}
            action={
              canAuthor ? (
                <Link className="plate plate--primary" to={`${base}/questions/new`}>
                  {t("bi.newQuestion")}
                </Link>
              ) : undefined
            }
          />
        ) : null}
      </div>

      {nothing ? null : (
        <ReportLists
          dashboards={dashboards.data}
          questions={questions.data}
          base={base}
          canAuthor={canAuthor}
        />
      )}

      {/* A customer with nothing yet still gets the dashboards band, because "make one" is
          the whole point of the page and an author should not have to guess where. */}
      {nothing && canAuthor ? (
        <DashboardBand items={dashboards.data} base={base} canAuthor={true} filtered={false} />
      ) : null}
    </div>
  );
}

/**
 * The search, the two views of the lists, and the one list the address chose, narrowed to
 * the names the search matches.
 */
function ReportLists({
  dashboards,
  questions,
  base,
  canAuthor,
}: {
  dashboards: readonly DashboardItem[];
  questions: readonly QuestionItem[];
  base: string;
  canAuthor: boolean;
}): React.JSX.Element {
  const [search] = useSearchParams();
  const query = search.get(REPORT_QUERY) ?? "";
  const showQuestions = search.get(VIEW) === QUESTIONS_VIEW;
  const filtered = query.trim() !== "";
  const matchedDashboards = byName(dashboards, query);
  const matchedQuestions = byName(questions, query);

  return (
    <>
      <div className="body stack">
        <ReportSearch query={query} />
        <ReportViews
          search={search}
          showQuestions={showQuestions}
          dashboards={matchedDashboards.length}
          questions={matchedQuestions.length}
        />
      </div>
      {showQuestions ? (
        <QuestionBand
          items={matchedQuestions}
          base={base}
          canAuthor={canAuthor}
          filtered={filtered}
        />
      ) : (
        <DashboardBand
          items={matchedDashboards}
          base={base}
          canAuthor={canAuthor}
          filtered={filtered}
        />
      )}
    </>
  );
}

/**
 * The two lists as a plate pair, as the Models division's views are. Each keeps the rest of
 * the address -- the search above all -- so switching lists keeps what was typed.
 */
function ReportViews({
  search,
  showQuestions,
  dashboards,
  questions,
}: {
  search: URLSearchParams;
  showQuestions: boolean;
  /** How many names the search matches in each list. */
  dashboards: number;
  questions: number;
}): React.JSX.Element {
  const { t } = useTranslation();
  const toDashboards = new URLSearchParams(search);
  toDashboards.delete(VIEW);
  const toQuestions = new URLSearchParams(search);
  toQuestions.set(VIEW, QUESTIONS_VIEW);

  return (
    <nav aria-label={t("reports.viewsLabel")} className="langset">
      <Link
        className="plate plate--small"
        to={{ search: toDashboards.toString() }}
        {...(showQuestions ? {} : { "aria-current": "page" as const })}
      >
        {t("reports.viewDashboards", { count: dashboards })}
      </Link>
      <Link
        className="plate plate--small"
        to={{ search: toQuestions.toString() }}
        {...(showQuestions ? { "aria-current": "page" as const } : {})}
      >
        {t("reports.viewQuestions", { count: questions })}
      </Link>
    </nav>
  );
}

/** The one field that searches both lists by name, writing the address as it is typed. */
function ReportSearch({ query }: { query: string }): React.JSX.Element {
  const { t } = useTranslation();
  const searchId = useId();
  const [, setSearch] = useSearchParams();

  function write(value: string): void {
    setSearch(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === "") {
          next.delete(REPORT_QUERY);
        } else {
          next.set(REPORT_QUERY, value);
        }
        return next;
      },
      { replace: true },
    );
  }

  return (
    <div className="row row--field">
      <div className="field">
        <label className="label" htmlFor={searchId}>
          {t("reports.searchLabel")}
        </label>
        <input
          autoComplete="off"
          className="input"
          id={searchId}
          placeholder={t("reports.searchPlaceholder")}
          type="search"
          value={query}
          onChange={(event): void => {
            write(event.currentTarget.value);
          }}
        />
      </div>
      {query === "" ? null : (
        <button
          className="plate"
          type="button"
          onClick={(): void => {
            write("");
          }}
        >
          {t("reports.clearSearch")}
        </button>
      )}
    </div>
  );
}

/** What has been put together, and how many questions each puts together. */
function DashboardTable({
  items,
  base,
}: {
  items: readonly DashboardItem[];
  base: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);

  return (
    <table className="table">
      <caption>{t("bi.dashboardsCaption", { count: items.length })}</caption>
      <thead>
        <tr>
          <th scope="col">{t("bi.colName")}</th>
          <th scope="col" className="num">
            {t("bi.colTiles")}
          </th>
          <th scope="col">{t("bi.colSaved")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((dashboard) => (
          <tr key={dashboard.id}>
            <td>
              <Link className="journal__what" to={`${base}/dashboards/${dashboard.id}`}>
                {dashboard.name}
              </Link>
            </td>
            <td className="num datum">{formatCount(dashboard.layout.tiles.length, locale)}</td>
            <td className="datum datum--quiet">{relativeTime(dashboard.updatedAt, locale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What has been asked, whether it was built or written, and how it is drawn. */
function QuestionTable({
  items,
  base,
}: {
  items: readonly QuestionItem[];
  base: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);

  return (
    <table className="table">
      <caption>{t("bi.questionsCaption", { count: items.length })}</caption>
      <thead>
        <tr>
          <th scope="col">{t("bi.colName")}</th>
          <th scope="col">{t("bi.colKind")}</th>
          <th scope="col">{t("bi.colChart")}</th>
          <th scope="col">{t("bi.colSaved")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((question) => (
          <tr key={question.id}>
            <td>
              <Link className="journal__what" to={`${base}/questions/${question.id}`}>
                {question.name}
              </Link>
            </td>
            <td className="datum datum--quiet">
              {question.definition.kind === "visual" ? t("bi.kindVisual") : t("bi.kindSql")}
            </td>
            <td className="datum datum--quiet">
              <ChartGlyph type={question.chart.type} />
            </td>
            <td className="datum datum--quiet">{relativeTime(question.updatedAt, locale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What has been put together, and the plate that starts another. */
function DashboardBand({
  items,
  base,
  canAuthor,
  filtered,
}: {
  /** When `filtered`, a band with none says no name matched rather than that none exist. */
  filtered: boolean;
  items: readonly DashboardItem[];
  base: string;
  canAuthor: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <>
      <div className="band-rule" />
      <div className="head">{t("bi.dashboardsHead")}</div>
      <div className="body stack">
        {items.length === 0 ? (
          <p className="note">
            {filtered ? t("reports.noDashboardMatches") : t("bi.noDashboards")}
          </p>
        ) : (
          <DashboardTable items={items} base={base} />
        )}
        <div className="row">
          {canAuthor ? (
            <Link className="plate" to={`${base}/dashboards/new`}>
              {t("bi.newDashboard")}
            </Link>
          ) : (
            <span className="label">{t("reports.readOnly")}</span>
          )}
        </div>
      </div>
    </>
  );
}

/** What has been asked, and the plate that asks another. */
function QuestionBand({
  items,
  base,
  canAuthor,
  filtered,
}: {
  /** When `filtered`, a band with none says no name matched rather than that none exist. */
  filtered: boolean;
  items: readonly QuestionItem[];
  base: string;
  canAuthor: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <>
      <div className="band-rule" />
      <div className="head">{t("bi.questionsHead")}</div>
      <div className="body stack">
        {items.length === 0 ? (
          <p className="note">{filtered ? t("reports.noQuestionMatches") : t("bi.noQuestions")}</p>
        ) : (
          <QuestionTable items={items} base={base} />
        )}
        <div className="row">
          {canAuthor ? (
            <Link className="plate plate--primary" to={`${base}/questions/new`}>
              {t("bi.newQuestion")}
            </Link>
          ) : (
            <span className="label">{t("reports.readOnly")}</span>
          )}
        </div>
      </div>
    </>
  );
}
