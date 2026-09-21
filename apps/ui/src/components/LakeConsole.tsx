/**
 * The raw lake's console: an admin's own SELECT over what landed, answered as rows.
 *
 * WHY IT EXISTS beside the browser above it. The browser pages one stream at a time with a
 * fixed shape, which answers "show me what is in here" and nothing else. An operator asking
 * "which of these documents did the extractor fail on, and how big were they" has to join
 * two tables and group -- a question the browser cannot be made to ask without becoming a
 * query builder. So the console is the release valve, and the browser stays simple.
 *
 * WHAT IT CAN REACH is `raw`, and only as the tenant's dbt login. That login is the one the
 * grant model lets read the lake; the BI login behind the Reports console cannot see `raw`
 * at all, and that stays true (ADR 0024). A write is refused by Postgres before any grant is
 * consulted, because the worker frames every query in a read-only transaction -- which
 * matters here because the dbt login CAN create in its own two schemas.
 *
 * HOW IT OPENS. Nobody's first gesture on this leaf is to write SQL. It is to click the line
 * of the index that says a stream exists -- and when they do, the console writes that
 * stream's SELECT for them and answers it, so the rows are on screen before they have typed
 * anything. What they then have is not a picture of a table but a query, one clause away
 * from the question they actually came with. The generated text is theirs to edit from that
 * moment: the seeding happens once per stream opened, never again on a redraw, because an
 * editor that overwrote what a reader had typed would be the one thing a scratch surface
 * must never do.
 *
 * WHY IT IS A WORKSPACE AND NOT A BAND. Every other band on this leaf is as tall as the
 * sentence it prints. A console is not: it holds two things that both want the screen, and
 * the first version gave each of them whatever the page had left over -- an editor too short
 * to write a join in and a grid too short to read the answer in, which is the one arrangement
 * that serves neither. So this band takes a definite height and divides it, and the divider
 * is the editor's own resize handle: the reader who is writing drags it down, the reader who
 * is reading drags it up, and nothing about that has to be remembered between visits.
 *
 * The draft lives in the store, keyed by tenant (`state.md`); CodeMirror owns its own
 * document and is uncontrolled, exactly as the model editor drives it.
 */

import type { SchemaResponse } from "@undercroft/contracts";
import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";
import { lazy, Suspense, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { TableResult } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { ResultTable } from "@/components/ResultTable.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { type LakeStream, streamKey, streamLabel, streamQuery } from "@/lib/lake.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const SqlEditor = lazy(() =>
  import("@/components/SqlEditor.tsx").then((module) => ({ default: module.SqlEditor })),
);

/**
 * What the editor holds before anybody types.
 *
 * A real query rather than a blank sheet or a comment: the first thing an operator wants is
 * "what have I got, by kind", and a console that answers that on the first press teaches its
 * own tables better than a placeholder can. `raw` is the search path, so the names are bare.
 */
const STARTER_SQL = `SELECT d.content_type,
       count(*)        AS files,
       count(t.method) AS readable,
       sum(t.chars)    AS total_chars
FROM documents d
LEFT JOIN document_text t
  ON t.source = d.source AND t.tenant_id = d.tenant_id AND t.document_id = d.document_id
WHERE d.deleted_at IS NULL
GROUP BY 1
ORDER BY 2 DESC`;

/** How many rows one page holds. The console pages; the author need not write LIMIT. */
const PAGE_ROWS = 100;

/** An `ORDER BY` anywhere in the author's SQL. Paging without one is not stable -- see below. */
const HAS_ORDER_BY = /\border\s+by\b/iu;

/** Every table the login can see, with its columns. The reference column, and nothing else. */
function SchemaList({ schema }: { schema: SchemaResponse }): React.JSX.Element | null {
  const { t } = useTranslation();

  if (schema.tables.length === 0) {
    // Not an error state worth a slip: the console works without the reference, and a
    // worker that is down already says so where the answer would have been.
    return null;
  }

  return (
    <aside className="console__aside">
      <span className="label">{t("lake.consoleTables")}</span>
      {schema.tables.map((table) => (
        <details className="console__table" key={table.name}>
          <summary className="datum">{table.name}</summary>
          <ul className="console__columns">
            {table.columns.map((column) => (
              <li key={column.name}>
                <span className="datum">{column.name}</span>
                <span className="datum datum--quiet">{column.type}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </aside>
  );
}

/**
 * Which page the reader is on, and the two presses that move it.
 *
 * The ORDER BY note lives here rather than beside the editor because it is only ever about
 * paging: a query read on one page is answered correctly whether or not it is ordered, and a
 * warning printed before the reader has asked for a second page is a warning about nothing.
 */
function Paging({
  sql,
  offset,
  more,
  busy,
  goTo,
}: {
  sql: string;
  offset: number;
  more: boolean;
  busy: boolean;
  goTo: (from: number) => void;
}): React.JSX.Element | null {
  const { t } = useTranslation();

  if (!more && offset === 0) {
    return null;
  }

  return (
    <div className="console__foot">
      <button
        className="plate plate--small"
        type="button"
        disabled={offset === 0 || busy}
        onClick={(): void => {
          goTo(Math.max(0, offset - PAGE_ROWS));
        }}
      >
        {t("lake.consoleNewer")}
      </button>
      <button
        className="plate plate--small"
        type="button"
        disabled={!more || busy}
        onClick={(): void => {
          goTo(offset + PAGE_ROWS);
        }}
      >
        {t("lake.consoleOlder")}
      </button>

      {/* PAGING A QUERY WITH NO ORDER BY IS NOT STABLE, and the reader is the only one who
          can fix it. Postgres may return a row on two pages or on neither when nothing
          orders the result, so a console that paged in silence would hand over a page that
          quietly is not the next one. */}
      {HAS_ORDER_BY.test(sql) ? null : (
        <span className="console__warn">{t("lake.consoleNoOrderBy")}</span>
      )}
    </div>
  );
}

/**
 * Where the answer goes: the rows, the refusal, or the sentence saying neither has happened.
 *
 * ONE PANE FOR ALL THREE, because to the reader they are the same slot -- the place they are
 * already looking after a press. A refusal printed above the editor instead sends them back
 * up the page to find out why nothing changed below it, and Postgres's sentence about their
 * SQL is the one thing that lets them fix it.
 */
function Answer({
  refusal,
  result,
  locale,
}: {
  refusal: string | null;
  result: TableResult | undefined;
  locale: Locale;
}): React.JSX.Element {
  const { t } = useTranslation();

  function shown(): React.JSX.Element {
    if (refusal !== null) {
      return (
        <Errata heading={t("lake.consoleRefused")} live={true}>
          {refusal}
        </Errata>
      );
    }
    if (result === undefined) {
      return <p className="note console__idle">{t("lake.consoleIdle")}</p>;
    }
    return <ResultTable result={result} locale={locale} fill={true} />;
  }

  return <div className="console__answer">{shown()}</div>;
}

/**
 * The verb, the chord that performs it, and what came back.
 *
 * The status says how many rows and which page, because those are the two things a reader
 * cannot work out from the grid itself -- a hundred rows look the same on page one and page
 * four. Nothing else: a bar that also carried the tenant, the login, the row cap and the
 * elapsed time would be four facts nobody reads to find the one they wanted.
 */
function RunBar({
  status,
  busy,
  empty,
  run,
}: {
  status: string | null;
  busy: boolean;
  empty: boolean;
  run: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="console__bar">
      <button className="plate plate--primary" type="button" disabled={busy || empty} onClick={run}>
        {t("lake.consoleRun")}
      </button>
      {/* The chord, printed once where the button is, so it is learnt from the thing it
          replaces rather than from a help page nobody opens. */}
      <kbd className="console__chord">{t("lake.consoleChord")}</kbd>
      <span className="console__status datum datum--quiet">{status}</span>
    </div>
  );
}

/**
 * What the run bar says right now, or nothing at all before the first press.
 *
 * The two facts a reader cannot get from the grid itself: how many rows came back, and
 * which page they are. A hundred rows look the same on page one and on page four.
 */
function runStatus(
  t: TFunction,
  state: { running: boolean; result: TableResult | undefined; offset: number },
): string | null {
  if (state.running) {
    return t("lake.consoleRunning");
  }
  if (state.result === undefined) {
    return null;
  }
  const count = state.result.rows.length;
  return state.offset === 0
    ? t("lake.consoleRows", { count })
    : t("lake.consoleRowsFrom", { count, from: state.offset + 1 });
}

/** What opening a line of the index leaves the console holding. */
interface Opened {
  /** The band itself, so the press that opened it can bring it into view. */
  readonly bandRef: React.RefObject<HTMLDivElement | null>;
  /** Part of the editor's remount key: a new stream replaces the editor's document. */
  readonly key: string;
  /** The query this stream was opened with, or null when no stream is open. */
  readonly query: string | null;
}

/**
 * Open the console on the stream the index linked to: write that stream's query, answer it,
 * and bring the answer into view. Once.
 *
 * ONCE IS THE WHOLE DIFFICULTY. The stream lives in the URL, so it is present on every
 * redraw, not just the one after the press -- and a console that re-seeded on each of them
 * would throw away whatever the reader had typed since. So what has already been opened is
 * recorded, per tenant, and compared before anything is written.
 *
 * The comparison reads the store directly rather than through a selector, because
 * StrictMode invokes an effect twice with the same captured value; a subscribed copy would
 * still be the pre-seed one on the second pass and would ask Postgres the same question
 * again for nothing.
 */
function useOpenedStream(
  tenantId: string,
  stream: LakeStream | null,
  ask: (input: { tenantId: string; sql: string; limit: number; offset: number }) => void,
): Opened {
  const bandRef = useRef<HTMLDivElement>(null);
  const setLakeSql = useUiStore((state) => state.setLakeSql);
  const setLakeOpened = useUiStore((state) => state.setLakeOpened);
  const key = stream === null ? "" : streamKey(stream);
  const query = stream === null ? null : streamQuery(stream);

  useEffect(() => {
    if (query === null || useUiStore.getState().lakeOpened[tenantId] === key) {
      return;
    }
    setLakeOpened(tenantId, key);
    setLakeSql(tenantId, query);
    ask({ tenantId, sql: query, limit: PAGE_ROWS, offset: 0 });
    // The index is three bands up this leaf. A press whose entire effect happens below the
    // fold reads as a press that did nothing, and the reader presses it again.
    bandRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [tenantId, key, query, ask, setLakeSql, setLakeOpened]);

  return { bandRef, key, query };
}

/**
 * Where the query came from, while it is still the one that was written.
 *
 * DERIVED FROM THE TEXT, not remembered: the moment the reader edits a character this stops
 * being true, and so it stops being said. A note kept in state instead would go on claiming
 * the query was generated long after it had been rewritten.
 */
function FromStream({
  stream,
  generated,
  sql,
}: {
  stream: LakeStream | null;
  generated: string | null;
  sql: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();

  if (stream === null || generated !== sql) {
    return null;
  }
  return <p className="note">{t("lake.consoleFromStream", { stream: streamLabel(t, stream) })}</p>;
}

export function LakeConsole({
  tenantId,
  locale,
  stream,
}: {
  tenantId: string;
  locale: Locale;
  /**
   * The stream the index has opened, from the URL, or null when the reader has opened none.
   * The console writes this stream's query for itself and answers it; see `useOpenedStream`.
   */
  stream?: LakeStream | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const sql = useUiStore((state) => state.lakeSql[tenantId]) ?? STARTER_SQL;
  const setLakeSql = useUiStore((state) => state.setLakeSql);
  const offset = useUiStore((state) => state.lakeOffset[tenantId]) ?? 0;
  const setLakeOffset = useUiStore((state) => state.setLakeOffset);
  const schema = trpc.lake.querySchema.useQuery({ tenantId });
  const run = trpc.lake.query.useMutation();
  const opened = useOpenedStream(tenantId, stream ?? null, run.mutate);

  /** Run from a given row. Every press goes through here, so the page and the rows agree. */
  function runFrom(from: number): void {
    setLakeOffset(tenantId, from);
    run.mutate({ tenantId, sql, limit: PAGE_ROWS, offset: from });
  }

  const more = run.data?.truncated === true;

  return (
    <div className="stack" ref={opened.bandRef}>
      <FromStream stream={stream ?? null} generated={opened.query} sql={sql} />

      <div className="console">
        <div className="console__work">
          <RunBar
            status={runStatus(t, { running: run.isPending, result: run.data, offset })}
            busy={run.isPending}
            empty={sql.trim() === ""}
            run={(): void => {
              runFrom(0);
            }}
          />

          <div className="console__editor">
            <Suspense fallback={<Skeleton rows={4} />}>
              <SqlEditor
                // Remounted per tenant AND per stream opened, never per keystroke:
                // CodeMirror owns the text and a value pushed back on every change would
                // fight the cursor and the history. The stream is in the key because
                // remounting is the only way a new document reaches an uncontrolled editor
                // -- opening a line of the index writes the draft, and this is what makes
                // the editor show it.
                key={`${tenantId}|${opened.key}`}
                value={sql}
                onChange={(next): void => {
                  setLakeSql(tenantId, next);
                }}
                onSubmit={(): void => {
                  runFrom(0);
                }}
                label={t("lake.consoleSqlLabel")}
                {...(schema.data === undefined ? {} : { schema: schema.data })}
              />
            </Suspense>
          </div>

          <Answer
            refusal={run.isError ? run.error.message : null}
            result={run.isError ? undefined : run.data}
            locale={locale}
          />

          <Paging sql={sql} offset={offset} more={more} busy={run.isPending} goTo={runFrom} />
        </div>

        {schema.data === undefined ? null : <SchemaList schema={schema.data} />}
      </div>

      {/* What this console is, said once, under it rather than over it: a standing fact
          about the surface, not an instruction for the query being written. */}
      <p className="prose prose--quiet">{t("lake.consoleLead")}</p>
    </div>
  );
}
