/**
 * The admin's browser over the raw lake: one stream at a time, its rows newest first, each
 * payload disclosed on demand exactly as Postgres rendered it.
 *
 * The open stream is the URL (`?source=&entity=` or `?documents=`), never the store: this is
 * a page an admin pastes to a colleague, and a reload lands on the same rows. What WRITES
 * that URL is the index above, in `LakeSummary` -- this file no longer carries a picker of
 * its own, because one that re-listed the streams the index had just printed made the leaf
 * name every stream twice. Pages come from the query cache as an infinite query on the
 * lake's own cursor.
 *
 * A payload is printed from the string the server sent, never re-parsed: JSON.parse would
 * turn every number into a float, and a browser that shows `12345678901234567000` where the
 * source said `12345678901234567890` is worse than one that shows nothing. Native
 * `<details>` holds whether it is open -- a disclosure is not application state. The copy plate
 * inside it hands the clipboard that same string, for the same reason.
 *
 * Admin-only, decided by the route and enforced by the server; this file only draws.
 *
 * A run narrows the stream to the rows it wrote (`&run=`, what a run's counts open from its
 * leaf; ADR 0091). A row names only the run that last wrote it, so the page says how many of the
 * run's own count a later run has since written again, rather than passing the shorter list off
 * as everything the run wrote -- and says nothing it cannot compute.
 */

import { useMutation } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import type { RunWrites } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
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
  type LakeStream,
  lakeStreamPath,
  parseRunFilter,
  parseStream,
  streamKey,
} from "@/lib/lake.ts";
import { formatBytes } from "@/lib/money.ts";
import { formatDate, formatDateTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const PAGE = 50;

/**
 * Which run the rows are narrowed to, what it wrote against what still names it, and the way back
 * to the whole stream.
 *
 * `writes` is the server's, computed and never estimated; when it is `null` the figures could not
 * be subtracted honestly (a run still going, a count the ledger does not hold), and this says
 * only which run the page is narrowed to.
 */
function RunNarrowing({
  tenantId,
  stream,
  runId,
  writes,
}: {
  tenantId: string;
  stream: LakeStream;
  runId: string;
  writes: RunWrites;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="stack stack--tight">
      <div className="row">
        <p className="note">{t("lake.runRows", { runId })}</p>
        <Link className="plate plate--small" to={lakeStreamPath(tenantId, stream)}>
          {t("lake.runWholeStream")}
        </Link>
      </div>
      {writes === null ? null : (
        <div className="stack stack--tight" role="status">
          <p className="prose">{t("lake.runWrote", { count: writes.wrote })}</p>
          <p className="prose">
            {writes.rewritten === 0
              ? t("lake.runNoneRewritten")
              : t("lake.runRewritten", { count: writes.rewritten })}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * One row's payload, folded, with the way to take the original string away.
 *
 * The copy is the server's string as it arrived, never parsed and re-printed -- a round trip
 * through `JSON.parse` is exactly what this browser refuses for display. It is a mutation, as
 * `OneTimeSecret`'s is, because the clipboard call is the one thing that knows whether it
 * worked: a browser may refuse it (no permission, an insecure origin), and the fold then says so
 * and points at the text above, which stays selectable. Its state is the fold's own and goes
 * with it; nothing else wants to know a copy happened.
 */
function PayloadFold({ payload }: { payload: string }): React.JSX.Element {
  const { t } = useTranslation();
  const copy = useMutation({
    mutationFn: (text: string) => navigator.clipboard.writeText(text),
  });

  return (
    <details className="payload">
      <summary className="plate plate--small">{t("lake.showPayload")}</summary>
      <div className="stack stack--tight">
        <pre className="payload__text">{payload}</pre>
        <div className="row">
          <button
            className="plate plate--small"
            type="button"
            disabled={copy.isPending}
            onClick={(): void => {
              copy.mutate(payload);
            }}
          >
            {t("lake.copyPayload")}
          </button>
          {copy.isSuccess ? (
            <p className="note" role="status">
              {t("lake.payloadCopied")}
            </p>
          ) : null}
          {copy.isError ? (
            <p className="note" role="status">
              {t("lake.copyBlocked")}
            </p>
          ) : null}
        </div>
      </div>
    </details>
  );
}

/** Present at the source, or deleted there on a date. Never a dash: both are facts. */
function atSource(t: TFunction, deletedAt: string | null, locale: "vi" | "en"): string {
  return deletedAt === null
    ? t("lake.live")
    : t("lake.deletedOn", { when: formatDate(deletedAt, locale) });
}

function RecordsTable({
  tenantId,
  source,
  entity,
  runId,
}: {
  tenantId: string;
  source: string;
  entity: string;
  runId: string | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const rows = trpc.lake.records.useInfiniteQuery(
    { tenantId, source, entity, limit: PAGE, ...(runId === null ? {} : { runId }) },
    { getNextPageParam: (page) => page.nextCursor ?? undefined },
  );

  if (rows.isPending) {
    return <Skeleton rows={4} />;
  }
  if (rows.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("lake.browserNotLoaded")}
      </Errata>
    );
  }
  const items = rows.data.pages.flatMap((page) => page.items);
  const stream: LakeStream = { kind: "records", source, entity };
  const narrowing =
    runId === null ? null : (
      <RunNarrowing
        tenantId={tenantId}
        stream={stream}
        runId={runId}
        writes={rows.data.pages[0]?.ofRun ?? null}
      />
    );
  if (items.length === 0) {
    return (
      <div className="stack">
        {narrowing}
        <p className="note">{runId === null ? t("lake.noRows") : t("lake.runNoRows")}</p>
      </div>
    );
  }
  const journal = divisionPath("journal", tenantId);

  return (
    <div className="stack">
      {narrowing}
      <Table>
        <TableCaption>{t("lake.rowsCaption", { count: items.length })}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t("lake.colRecordId")}</TableHead>
            <TableHead scope="col">{t("lake.colObserved")}</TableHead>
            <TableHead scope="col">{t("lake.colLoaded")}</TableHead>
            <TableHead scope="col">{t("lake.colRun")}</TableHead>
            <TableHead scope="col">{t("lake.colAtSource")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => (
            <TableRow key={row.sourceRecordId}>
              <TableCell>
                <span className="datum">{row.sourceRecordId}</span>
                <PayloadFold payload={row.payload} />
              </TableCell>
              <TableCell className="datum datum--quiet">
                {formatDateTime(row.observedAt, locale)}
              </TableCell>
              <TableCell className="datum datum--quiet">
                {formatDateTime(row.loadedAt, locale)}
              </TableCell>
              <TableCell className="datum datum--quiet">
                <Link to={`${journal}/${row.runId}`}>{row.runId}</Link>
              </TableCell>
              <TableCell className="datum datum--quiet">
                {atSource(t, row.deletedAt, locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.hasNextPage ? (
        <div className="row">
          <button
            className="plate"
            type="button"
            disabled={rows.isFetchingNextPage}
            onClick={(): void => {
              void rows.fetchNextPage();
            }}
          >
            {rows.isFetchingNextPage ? t("lake.loadingOlder") : t("lake.older")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DocumentsTable({
  tenantId,
  source,
  runId,
}: {
  tenantId: string;
  source: string;
  runId: string | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const rows = trpc.lake.documents.useInfiniteQuery(
    { tenantId, source, limit: PAGE, ...(runId === null ? {} : { runId }) },
    { getNextPageParam: (page) => page.nextCursor ?? undefined },
  );

  if (rows.isPending) {
    return <Skeleton rows={4} />;
  }
  if (rows.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("lake.browserNotLoaded")}
      </Errata>
    );
  }
  const items = rows.data.pages.flatMap((page) => page.items);
  const stream: LakeStream = { kind: "documents", source };
  const narrowing =
    runId === null ? null : (
      <RunNarrowing
        tenantId={tenantId}
        stream={stream}
        runId={runId}
        writes={rows.data.pages[0]?.ofRun ?? null}
      />
    );
  if (items.length === 0) {
    return (
      <div className="stack">
        {narrowing}
        <p className="note">{runId === null ? t("lake.noRows") : t("lake.runNoRows")}</p>
      </div>
    );
  }
  const journal = divisionPath("journal", tenantId);

  return (
    <div className="stack">
      {narrowing}
      <Table>
        <TableCaption>{t("lake.docsCaption", { count: items.length })}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t("lake.colDocumentId")}</TableHead>
            <TableHead scope="col">{t("lake.colContentType")}</TableHead>
            <TableHead scope="col" className="num">
              {t("lake.colBytes")}
            </TableHead>
            <TableHead scope="col">{t("lake.colObserved")}</TableHead>
            <TableHead scope="col">{t("lake.colRun")}</TableHead>
            <TableHead scope="col">{t("lake.colAtSource")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => (
            <TableRow key={row.documentId}>
              <TableCell className="datum">{row.documentId}</TableCell>
              <TableCell className="datum datum--quiet">{row.contentType}</TableCell>
              <TableCell className="num datum">{formatBytes(row.bytes, locale)}</TableCell>
              <TableCell className="datum datum--quiet">
                {formatDateTime(row.observedAt, locale)}
              </TableCell>
              <TableCell className="datum datum--quiet">
                <Link to={`${journal}/${row.runId}`}>{row.runId}</Link>
              </TableCell>
              <TableCell className="datum datum--quiet">
                {atSource(t, row.deletedAt, locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.hasNextPage ? (
        <div className="row">
          <button
            className="plate"
            type="button"
            disabled={rows.isFetchingNextPage}
            onClick={(): void => {
              void rows.fetchNextPage();
            }}
          >
            {rows.isFetchingNextPage ? t("lake.loadingOlder") : t("lake.older")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The rows of whichever stream the index opened.
 *
 * NO PICKER OF ITS OWN ANY MORE. This used to carry a `<select>` that re-listed every stream
 * the index above had just printed, so the leaf named each stream twice and a reader who had
 * read "Drive · 122 documents" still had to go and find that sentence again, inside a closed
 * control, before they could look at it. The index rows link here instead: one list of what
 * landed, and each line is the way in.
 *
 * The open stream is still the URL (`?source=&entity=`, `?documents=`), unchanged, so a
 * pasted link still opens on the same rows.
 */
export function LakeBrowser({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const chosen = parseStream(params);
  const runId = parseRunFilter(params);

  if (chosen === null) {
    // Not an error and not empty: the reader has simply not opened a line yet. The index is
    // directly above, so this says which gesture is missing rather than offering a second way.
    return <p className="prose prose--quiet">{t("lake.chooseFromIndex")}</p>;
  }

  return (
    <div className="stack">
      <p className="prose">{t("lake.browserLead")}</p>
      {chosen.kind === "records" ? (
        <RecordsTable
          key={`${streamKey(chosen)}|${runId ?? ""}`}
          tenantId={tenantId}
          source={chosen.source}
          entity={chosen.entity}
          runId={runId}
        />
      ) : (
        <DocumentsTable
          key={`${streamKey(chosen)}|${runId ?? ""}`}
          tenantId={tenantId}
          source={chosen.source}
          runId={runId}
        />
      )}
    </div>
  );
}
