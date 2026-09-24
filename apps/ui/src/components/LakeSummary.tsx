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
 * A document source's reading is three figures, not one gap: read, refused, and not read yet.
 * A mailbox whose refusals are signature images and a mailbox the extract verb has not reached
 * used to print the same "55/122 readable", and the first was read as mass breakage (issue
 * #139). Where there are refusals the row also unfolds WHY, in place, through the same
 * `RefusalRollup` a run's leaf uses -- so benign and actionable are decided in one place
 * (`refusalReasons.ts`) and drawn one way. It unfolds reasons and counts only: which documents
 * they were is an admin's, and this index is every member's.
 *
 * Presentational: values in, a leaf out. The route fetches; this prints. The one thing it
 * keeps is which source's refusals are unfolded, and that is the store's (`state.md`).
 */

import type { Locale } from "@undercroft/core/locale";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { Connection, LakeSummary as Summary } from "@/api/types.ts";
import { EmptyState } from "@/components/EmptyState.tsx";
import { RefusalRollup } from "@/components/RefusalRollup.tsx";
import { StatusMark } from "@/components/StatusMark.tsx";
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
  type DocumentReasons,
  inventoryOf,
  type LakeEntry,
  lakeEmptyBody,
  type LakeStream,
  sameStream,
  streamKey,
} from "@/lib/lake.ts";
import { formatBytes, formatCount } from "@/lib/money.ts";
import { anyActionable } from "@/lib/refusalReasons.ts";
import { type AccountName, sourceLabel } from "@/lib/runs.ts";
import { relativeTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";

/** The index's columns, which an unfolded source's refusals span. */
const COLUMNS = 5;

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
  /**
   * When the first run comes, for the empty leaf, and which account a stream belongs to, for a
   * tenant with two mailboxes whose lines would otherwise both read "Gmail". See `sourceLabel`.
   */
  connections: readonly (Pick<Connection, "nextRunAt"> & AccountName)[];
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
  const openRefusals = useUiStore((state) => state.openLakeRefusals[tenantId]);
  const toggleRefusals = useUiStore((state) => state.toggleLakeRefusals);
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
                source={sourceLabel(entry.stream.source, connections)}
                locale={locale}
                open={sameStream(entry.stream, openStream ?? null)}
                refusalsOpen={
                  entry.stream.kind === "documents" && openRefusals === entry.stream.source
                }
                onToggleRefusals={(): void => {
                  toggleRefusals(tenantId, entry.stream.source);
                }}
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
  source,
  locale,
  open,
  refusalsOpen,
  onToggleRefusals,
  href,
}: {
  entry: LakeEntry;
  /** The stream's source as the reader names it, account included. */
  source: string;
  locale: Locale;
  open: boolean;
  /** Whether this source's refusal reasons are unfolded under the row. */
  refusalsOpen: boolean;
  onToggleRefusals: () => void;
  href?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { stream, note } = entry;
  const holds = stream.kind === "records" ? stream.entity : t("lake.streamDocuments");
  const reasons = note.kind === "bytes" ? note.reasons : [];
  const panelId = `lake-refusals-${streamKey(stream)}`.replaceAll(/[^\w-]/gu, "_");

  return (
    <>
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
            ? // `count` is the distinct-blob figure because that is the noun the sentence
              // pluralises; the others are plain interpolations. One key, one sentence --
              // a line assembled from translated fragments could only be right in the language
              // it was assembled in (`.claude/rules/i18n.md`).
              t("lake.alsoBytesRead", {
                bytes: formatBytes(note.bytes, locale),
                count: note.distinctBlobs,
                readable: note.readable,
                refused: note.refused,
                waiting: note.waiting,
                total: note.total,
              })
            : null}
          {note.kind === "tombstoned" ? t("lake.alsoTombstoned", { count: note.count }) : null}
          {reasons.length > 0 ? (
            <RefusalsToggle
              reasons={reasons}
              open={refusalsOpen}
              panelId={panelId}
              onToggle={onToggleRefusals}
            />
          ) : null}
        </TableCell>
        <TableCell className="datum datum--quiet">
          {relativeTime(entry.latestObservedAt, locale)}
        </TableCell>
      </TableRow>
      {refusalsOpen && reasons.length > 0 ? (
        <TableRow className="table__hinge">
          <TableCell colSpan={COLUMNS}>
            <div className="hinge" id={panelId}>
              <span className="hinge__punch hinge__punch--a" aria-hidden="true" />
              <span className="hinge__punch hinge__punch--b" aria-hidden="true" />
              <RefusalRollup scope={`lake|${streamKey(stream)}`} reasonCounts={reasons} />
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

/**
 * The way into a source's refusals, and the one-word verdict on them before anyone opens it.
 *
 * The mark is the point: "Nothing to do" beside 230 refusals is the sentence that stops an
 * operator opening an SSH session over signature images, and "Needs attention" is the one that
 * should. `anyActionable` decides it, from the same lists the rollup's own rows are marked by.
 */
function RefusalsToggle({
  reasons,
  open,
  panelId,
  onToggle,
}: {
  reasons: DocumentReasons;
  open: boolean;
  panelId: string;
  onToggle: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const acts = anyActionable(reasons);

  return (
    <span className="row">
      <button
        className="plate plate--small"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        {t("lake.refusalsOpen")}
      </button>
      <StatusMark
        mark={acts ? "lapsed" : "granted"}
        label={acts ? t("journal.reasonActs") : t("journal.reasonBenign")}
      />
    </span>
  );
}
