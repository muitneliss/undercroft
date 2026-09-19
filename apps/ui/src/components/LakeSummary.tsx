/**
 * What has landed, printed: one line per stream of records and one per source of
 * documents, with counts and the newest observation. This is the Lake division's answer to
 * "did anything come in", readable by every member because it carries no payload.
 *
 * A customer with nothing landed gets an unprinted leaf that says when the first run comes,
 * from the same schedule the journal reads, rather than two empty tables. Tombstones are a
 * column of their own: a row the source has since deleted is still a row we hold, and a
 * count that quietly folded it in would be a count nobody could reconcile against the
 * source.
 *
 * Presentational: values in, a leaf out. The route fetches; this prints.
 */

import type { Locale } from "@undercroft/core/locale";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { Connection, LakeSummary as Summary } from "@/api/types.ts";
import { EmptyState } from "@/components/EmptyState.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { lakeEmptyBody } from "@/lib/lake.ts";
import { formatBytes, formatCount } from "@/lib/money.ts";
import { sourceLabel } from "@/lib/runs.ts";
import { relativeTime } from "@/lib/when.ts";

export function LakeSummary({
  tenantId,
  summary,
  connections,
  locale,
}: {
  tenantId: string;
  summary: Summary;
  /** For the empty leaf only: when the first run comes. */
  connections: readonly Pick<Connection, "nextRunAt">[];
  locale: Locale;
}): React.JSX.Element {
  const { t } = useTranslation();
  const nothing = summary.records.length === 0 && summary.documents.length === 0;

  return (
    <>
      <h1>{t("lake.title")}</h1>
      <p className="prose prose--lead">{t("lake.lead", { tenantId })}</p>

      {nothing ? (
        <EmptyState
          title={t("lake.emptyTitle")}
          body={lakeEmptyBody(t, locale, connections)}
          action={
            <Link className="plate" to={divisionPath("sources", tenantId)}>
              {t("lake.goToSources")}
            </Link>
          }
        />
      ) : null}

      {summary.records.length > 0 ? (
        <table className="table">
          <caption>{t("lake.recordsCaption", { count: summary.records.length })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("lake.colSource")}</th>
              <th scope="col">{t("lake.colEntity")}</th>
              <th scope="col" className="num">
                {t("lake.colRecords")}
              </th>
              <th scope="col" className="num">
                {t("lake.colTombstoned")}
              </th>
              <th scope="col">{t("lake.colLatest")}</th>
            </tr>
          </thead>
          <tbody>
            {summary.records.map((stream) => (
              <tr key={`${stream.source}/${stream.entity}`}>
                <td className="datum">{sourceLabel(stream.source)}</td>
                <td className="datum">{stream.entity}</td>
                <td className="num datum">{formatCount(stream.records, locale)}</td>
                <td className="num datum datum--quiet">{formatCount(stream.tombstoned, locale)}</td>
                <td className="datum datum--quiet">
                  {relativeTime(stream.latestObservedAt, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {summary.documents.length > 0 ? (
        <table className="table">
          <caption>{t("lake.documentsCaption", { count: summary.documents.length })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("lake.colSource")}</th>
              <th scope="col" className="num">
                {t("lake.colDocuments")}
              </th>
              <th scope="col" className="num">
                {t("lake.colBytes")}
              </th>
              <th scope="col">{t("lake.colLatest")}</th>
            </tr>
          </thead>
          <tbody>
            {summary.documents.map((source) => (
              <tr key={source.source}>
                <td className="datum">{sourceLabel(source.source)}</td>
                <td className="num datum">{formatCount(source.documents, locale)}</td>
                <td className="num datum">{formatBytes(source.bytes, locale)}</td>
                <td className="datum datum--quiet">
                  {relativeTime(source.latestObservedAt, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
