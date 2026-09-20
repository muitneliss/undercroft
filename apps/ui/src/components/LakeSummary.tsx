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
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
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
        <Table>
          <TableCaption>{t("lake.recordsCaption", { count: summary.records.length })}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t("lake.colSource")}</TableHead>
              <TableHead scope="col">{t("lake.colEntity")}</TableHead>
              <TableHead scope="col" className="num">
                {t("lake.colRecords")}
              </TableHead>
              <TableHead scope="col" className="num">
                {t("lake.colTombstoned")}
              </TableHead>
              <TableHead scope="col">{t("lake.colLatest")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.records.map((stream) => (
              <TableRow key={`${stream.source}/${stream.entity}`}>
                <TableCell className="datum">{sourceLabel(stream.source)}</TableCell>
                <TableCell className="datum">{stream.entity}</TableCell>
                <TableCell className="num datum">{formatCount(stream.records, locale)}</TableCell>
                <TableCell className="num datum datum--quiet">
                  {formatCount(stream.tombstoned, locale)}
                </TableCell>
                <TableCell className="datum datum--quiet">
                  {relativeTime(stream.latestObservedAt, locale)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {summary.documents.length > 0 ? (
        <Table>
          <TableCaption>
            {t("lake.documentsCaption", { count: summary.documents.length })}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t("lake.colSource")}</TableHead>
              <TableHead scope="col" className="num">
                {t("lake.colDocuments")}
              </TableHead>
              <TableHead scope="col" className="num">
                {t("lake.colBytes")}
              </TableHead>
              <TableHead scope="col">{t("lake.colLatest")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.documents.map((source) => (
              <TableRow key={source.source}>
                <TableCell className="datum">{sourceLabel(source.source)}</TableCell>
                <TableCell className="num datum">{formatCount(source.documents, locale)}</TableCell>
                <TableCell className="num datum">{formatBytes(source.bytes, locale)}</TableCell>
                <TableCell className="datum datum--quiet">
                  {relativeTime(source.latestObservedAt, locale)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </>
  );
}
