/**
 * The admin's browser over the raw lake: one stream at a time, its rows newest first, each
 * payload disclosed on demand exactly as Postgres rendered it.
 *
 * The open stream is the URL (`?source=&entity=` or `?documents=`), never the store: this is
 * a page an admin pastes to a colleague, and a reload lands on the same rows. The picker is
 * a `<select>` whose value IS the URL's, so there is one owner. Pages come from the query
 * cache as an infinite query on the lake's own cursor.
 *
 * A payload is printed from the string the server sent, never re-parsed: JSON.parse would
 * turn every number into a float, and a browser that shows `12345678901234567000` where the
 * source said `12345678901234567890` is worse than one that shows nothing. Native
 * `<details>` holds whether it is open -- a disclosure is not application state.
 *
 * Admin-only, decided by the route and enforced by the server; this file only draws.
 */

import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import {
  type LakeStream,
  parseStream,
  streamFromKey,
  streamKey,
  streamLabel,
  streamParams,
} from "@/lib/lake.ts";
import { formatBytes } from "@/lib/money.ts";
import { formatDate, formatDateTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";
import { useId } from "react";

const PAGE = 50;

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
}: {
  tenantId: string;
  source: string;
  entity: string;
}): React.JSX.Element {
  const lakeStreamId = useId();
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const rows = trpc.lake.records.useInfiniteQuery(
    { tenantId, source, entity, limit: PAGE },
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
  if (items.length === 0) {
    return <p className="note">{t("lake.noRows")}</p>;
  }
  const journal = divisionPath("journal", tenantId);

  return (
    <div className="stack">
      <table className="table">
        <caption>{t("lake.rowsCaption", { count: items.length })}</caption>
        <thead>
          <tr>
            <th scope="col">{t("lake.colRecordId")}</th>
            <th scope="col">{t("lake.colObserved")}</th>
            <th scope="col">{t("lake.colLoaded")}</th>
            <th scope="col">{t("lake.colRun")}</th>
            <th scope="col">{t("lake.colAtSource")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.sourceRecordId}>
              <td>
                <span className="datum">{row.sourceRecordId}</span>
                <details className="payload">
                  <summary className="plate plate--small">{t("lake.showPayload")}</summary>
                  <pre className="payload__text">{row.payload}</pre>
                </details>
              </td>
              <td className="datum datum--quiet">{formatDateTime(row.observedAt, locale)}</td>
              <td className="datum datum--quiet">{formatDateTime(row.loadedAt, locale)}</td>
              <td className="datum datum--quiet">
                <Link to={`${journal}/${row.runId}`}>{row.runId}</Link>
              </td>
              <td className="datum datum--quiet">{atSource(t, row.deletedAt, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
            {t("lake.older")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DocumentsTable({
  tenantId,
  source,
}: {
  tenantId: string;
  source: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const rows = trpc.lake.documents.useInfiniteQuery(
    { tenantId, source, limit: PAGE },
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
  if (items.length === 0) {
    return <p className="note">{t("lake.noRows")}</p>;
  }
  const journal = divisionPath("journal", tenantId);

  return (
    <div className="stack">
      <table className="table">
        <caption>{t("lake.docsCaption", { count: items.length })}</caption>
        <thead>
          <tr>
            <th scope="col">{t("lake.colDocumentId")}</th>
            <th scope="col">{t("lake.colContentType")}</th>
            <th scope="col" className="num">
              {t("lake.colBytes")}
            </th>
            <th scope="col">{t("lake.colObserved")}</th>
            <th scope="col">{t("lake.colRun")}</th>
            <th scope="col">{t("lake.colAtSource")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.documentId}>
              <td className="datum">{row.documentId}</td>
              <td className="datum datum--quiet">{row.contentType}</td>
              <td className="num datum">{formatBytes(row.bytes, locale)}</td>
              <td className="datum datum--quiet">{formatDateTime(row.observedAt, locale)}</td>
              <td className="datum datum--quiet">
                <Link to={`${journal}/${row.runId}`}>{row.runId}</Link>
              </td>
              <td className="datum datum--quiet">{atSource(t, row.deletedAt, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
            {t("lake.older")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function LakeBrowser({
  tenantId,
  streams,
}: {
  tenantId: string;
  /** Every stream the summary counted; the picker offers exactly these. */
  streams: readonly LakeStream[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const lakeStreamId = useId();
  const [params, setParams] = useSearchParams();
  const chosen = parseStream(params);
  const records = streams.filter((s) => s.kind === "records");
  const documents = streams.filter((s) => s.kind === "documents");

  return (
    <div className="stack">
      <p className="prose">{t("lake.browserLead")}</p>

      <div className="field">
        <label className="label" htmlFor={lakeStreamId}>
          {t("lake.streamLabel")}
        </label>
        <select
          className="input input--select"
          id={lakeStreamId}
          value={chosen === null ? "" : streamKey(chosen)}
          onChange={(event): void => {
            const next = streamFromKey(event.currentTarget.value);
            setParams(next === null ? {} : streamParams(next));
          }}
        >
          <option value="">{t("lake.chooseStream")}</option>
          {records.length > 0 ? (
            <optgroup label={t("lake.streamRecords")}>
              {records.map((stream) => (
                <option key={streamKey(stream)} value={streamKey(stream)}>
                  {streamLabel(t, stream)}
                </option>
              ))}
            </optgroup>
          ) : null}
          {documents.length > 0 ? (
            <optgroup label={t("lake.documentsHead")}>
              {documents.map((stream) => (
                <option key={streamKey(stream)} value={streamKey(stream)}>
                  {streamLabel(t, stream)}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </div>

      {chosen?.kind === "records" ? (
        <RecordsTable
          key={streamKey(chosen)}
          tenantId={tenantId}
          source={chosen.source}
          entity={chosen.entity}
        />
      ) : null}
      {chosen?.kind === "documents" ? (
        <DocumentsTable key={streamKey(chosen)} tenantId={tenantId} source={chosen.source} />
      ) : null}
    </div>
  );
}
