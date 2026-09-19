/**
 * The reports division: the customer's dashboards and questions, listed.
 *
 * A question is a query over the built models -- made in the builder or written as SQL --
 * and how it is drawn; a dashboard puts questions together under shared filters. Members
 * and admins author; a viewer reads what was made for them. The plate that starts a new
 * question is hidden from a viewer as courtesy; the server refuses regardless.
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { DashboardItem, QuestionItem } from "@/api/types.ts";
import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { formatCount } from "@/lib/money.ts";
import { relativeTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

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
        <>
          <DashboardBand items={dashboards.data} base={base} canAuthor={canAuthor} />
          <QuestionBand items={questions.data} base={base} canAuthor={canAuthor} />
        </>
      )}

      {/* A customer with nothing yet still gets the dashboards band, because "make one" is
          the whole point of the page and an author should not have to guess where. */}
      {nothing && canAuthor ? (
        <DashboardBand items={dashboards.data} base={base} canAuthor={true} />
      ) : null}
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
          <th scope="col">{t("bi.colUpdated")}</th>
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
          <th scope="col">{t("bi.colUpdated")}</th>
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
            <td className="datum datum--quiet">{question.chart.type}</td>
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
}: {
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
          <p className="note">{t("bi.noDashboards")}</p>
        ) : (
          <DashboardTable items={items} base={base} />
        )}
        {canAuthor ? (
          <div className="row">
            <Link className="plate" to={`${base}/dashboards/new`}>
              {t("bi.newDashboard")}
            </Link>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** What has been asked, and the plate that asks another. */
function QuestionBand({
  items,
  base,
  canAuthor,
}: {
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
          <p className="note">{t("bi.noQuestions")}</p>
        ) : (
          <QuestionTable items={items} base={base} />
        )}
        {canAuthor ? (
          <div className="row">
            <Link className="plate plate--primary" to={`${base}/questions/new`}>
              {t("bi.newQuestion")}
            </Link>
          </div>
        ) : null}
      </div>
    </>
  );
}
