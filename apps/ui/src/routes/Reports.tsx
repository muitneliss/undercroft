/**
 * The reports division: the customer's dashboards and questions, listed.
 *
 * A question is a query over the built models -- made in the builder or written as SQL --
 * and how it is drawn; a dashboard puts questions together under shared filters. Members
 * and admins author; a viewer reads what was made for them. The plate that starts a new
 * question is hidden from a viewer as courtesy; the server refuses regardless.
 */

// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Same functions as noExcessiveLinesPerFunction: one sequential procedure each, whose branches are the states the thing being driven can actually be in.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

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
  const locale = useUiStore((state) => state.locale);
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
          <div className="band-rule" />
          <div className="head">{t("bi.dashboardsHead")}</div>
          <div className="body stack">
            {dashboards.data.length === 0 ? (
              <p className="note">{t("bi.noDashboards")}</p>
            ) : (
              <table className="table">
                <caption>{t("bi.dashboardsCaption", { count: dashboards.data.length })}</caption>
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
                  {dashboards.data.map((dashboard) => (
                    <tr key={dashboard.id}>
                      <td className="datum">{dashboard.name}</td>
                      <td className="num datum">
                        {formatCount(dashboard.layout.tiles.length, locale)}
                      </td>
                      <td className="datum datum--quiet">
                        {relativeTime(dashboard.updatedAt, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="band-rule" />
          <div className="head">{t("bi.questionsHead")}</div>
          <div className="body stack">
            {questions.data.length === 0 ? (
              <p className="note">{t("bi.noQuestions")}</p>
            ) : (
              <table className="table">
                <caption>{t("bi.questionsCaption", { count: questions.data.length })}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("bi.colName")}</th>
                    <th scope="col">{t("bi.colKind")}</th>
                    <th scope="col">{t("bi.colChart")}</th>
                    <th scope="col">{t("bi.colUpdated")}</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.data.map((question) => (
                    <tr key={question.id}>
                      <td>
                        <Link className="journal__what" to={`${base}/questions/${question.id}`}>
                          {question.name}
                        </Link>
                      </td>
                      <td className="datum datum--quiet">
                        {question.definition.kind === "visual"
                          ? t("bi.kindVisual")
                          : t("bi.kindSql")}
                      </td>
                      <td className="datum datum--quiet">{question.chart.type}</td>
                      <td className="datum datum--quiet">
                        {relativeTime(question.updatedAt, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
      )}
    </div>
  );
}
