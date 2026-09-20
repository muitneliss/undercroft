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
import {
  inventoryOf,
  type LakeEntry,
  lakeEmptyBody,
  type LakeStream,
  sameStream,
  streamKey,
} from "@/lib/lake.ts";
import { formatBytes, formatCount } from "@/lib/money.ts";
import { sourceLabel } from "@/lib/runs.ts";
import { relativeTime } from "@/lib/when.ts";

export function LakeSummary({
  tenantId,
  summary,
  connections,
  locale,
  hrefFor,
  openStream,
}: {
  tenantId: string;
  summary: Summary;
  /** For the empty leaf only: when the first run comes. */
  connections: readonly Pick<Connection, "nextRunAt">[];
  locale: Locale;
  /**
   * Where a stream's own rows are read. Absent for a reader who may not browse them, whose
   * index is therefore the same facts as plain text -- the counts are theirs, the payload
   * is not, and a link they cannot follow would be a promise this leaf does not keep.
   */
  hrefFor?: (stream: LakeStream) => string;
  /** The stream currently open below, so the index can mark which line is being read. */
  openStream?: LakeStream | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const entries = inventoryOf(summary);
  const nothing = entries.length === 0;

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

      {entries.length > 0 ? (
        <Table>
          <TableCaption>{t("lake.indexCaption", { count: entries.length })}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t("lake.colSource")}</TableHead>
              <TableHead scope="col">{t("lake.colHolds")}</TableHead>
              <TableHead scope="col" className="num">
                {t("lake.colHeld")}
              </TableHead>
              <TableHead scope="col">{t("lake.colAlso")}</TableHead>
              <TableHead scope="col">{t("lake.colLatest")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <IndexRow
                key={streamKey(entry.stream)}
                entry={entry}
                locale={locale}
                open={sameStream(entry.stream, openStream ?? null)}
                {...(hrefFor === undefined ? {} : { href: hrefFor(entry.stream) })}
              />
            ))}
          </TableBody>
        </Table>
      ) : null}
    </>
  );
}

/**
 * One line of the index, and the way into it.
 *
 * The whole point of this leaf's rework: the row that TELLS you a stream exists is the row
 * that OPENS it. It used to take a second control, in a second band, listing the same streams
 * again inside a closed `<select>` -- so a reader who had just read "Drive · 122 documents"
 * had to go and find that same sentence a second time before they could look at it.
 *
 * A real `<a href>`, not a click handler: it keeps the shareable `?source=&entity=` URL the
 * old picker already wrote, opens in a new tab on a middle click, and is reachable by
 * keyboard without anything being added for it. A reader who may not browse gets the same
 * row as plain text -- the facts are theirs, the payload is not.
 */
function IndexRow({
  entry,
  locale,
  open,
  href,
}: {
  entry: LakeEntry;
  locale: Locale;
  open: boolean;
  href?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { stream, note } = entry;
  const holds = stream.kind === "records" ? stream.entity : t("lake.streamDocuments");
  const source = sourceLabel(stream.source);

  return (
    <TableRow className={open ? "lake-index__row lake-index__row--open" : "lake-index__row"}>
      <TableCell className="datum">
        {href === undefined ? (
          source
        ) : (
          // The punched hole this system marks a selection with, drawn by CSS on the row.
          <Link className="lake-index__link" to={href} aria-current={open ? "true" : undefined}>
            {source}
          </Link>
        )}
      </TableCell>
      <TableCell className="datum">{holds}</TableCell>
      <TableCell className="num datum">{formatCount(entry.held, locale)}</TableCell>
      <TableCell className="datum datum--quiet">
        {note.kind === "bytes"
          ? t("lake.alsoBytesReadable", {
              bytes: formatBytes(note.bytes, locale),
              readable: note.readable,
              total: note.total,
            })
          : null}
        {note.kind === "tombstoned" ? t("lake.alsoTombstoned", { count: note.count }) : null}
      </TableCell>
      <TableCell className="datum datum--quiet">{relativeTime(entry.latestObservedAt, locale)}</TableCell>
    </TableRow>
  );
}
