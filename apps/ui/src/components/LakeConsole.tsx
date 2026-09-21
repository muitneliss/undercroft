/**
 * The raw lake's console: an admin's own SELECT over what landed, answered as rows.
 *
 * WHY IT EXISTS beside the browser on the lake's index. The browser pages one stream at a
 * time with a fixed shape, which answers "show me what is in here" and nothing else. An
 * operator asking "which of these documents did the extractor fail on, and how big were
 * they" has to join two tables and group -- a question the browser cannot be made to ask
 * without becoming a query builder. So the console is the release valve, and the browser
 * stays simple.
 *
 * WHAT IT CAN REACH is `raw`, and only as the tenant's dbt login. That login is the one the
 * grant model lets read the lake; the BI login behind the Reports console cannot see `raw`
 * at all, and that stays true (ADR 0024). A write is refused by Postgres before any grant is
 * consulted, because the worker frames every query in a read-only transaction -- which
 * matters here because the dbt login CAN create in its own two schemas.
 *
 * HOW IT OPENS. Nobody's first gesture is to write SQL. It is to press the line of the lake's
 * index that says a stream exists -- and when they do, this page opens with that stream's
 * SELECT already written and answered, so the rows are on screen before they have typed
 * anything. What they then have is not a picture of a table but a query, one clause away from
 * the question they actually came with. The generated text is theirs to edit from that
 * moment: the seeding happens once per stream opened, never again on a redraw, because an
 * editor that overwrote what a reader had typed would be the one thing a scratch surface must
 * never do.
 *
 * WHY IT IS A PAGE AND NOT A BAND. Every other band on the lake's leaf is as tall as the
 * sentence it prints. A console is not: it holds two things that both want the whole screen,
 * and as a band it got whatever the leaf had left over -- an editor too short to write a join
 * in above a grid too short to read the answer in, which is the one arrangement that serves
 * neither, three unrelated bands scrolled off above it. So the console took the leaf:
 * `leaf--fill` binds the page to the window, and this component divides that definite height
 * into a reference, a query and an answer. The tab strip and the running head stay, because
 * an operator holding four customers' books at once must never be one press from running a
 * query against the wrong one.
 *
 * The draft lives in the store, keyed by tenant (`state.md`); CodeMirror owns its own
 * document and is uncontrolled, exactly as the model editor drives it.
 */

import type { SchemaResponse } from "@undercroft/contracts";
import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";
import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { TableResult } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { ArrowLeft, ArrowRight } from "@/components/Icon.tsx";
import { ResultTable } from "@/components/ResultTable.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { divisionPath } from "@/lib/divisions.ts";
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

/**
 * Every table the login can see, with its columns, down the left of the workbench.
 *
 * FOLDABLE, and that is the whole reason it is a rail rather than a column. The two things a
 * reader does here want opposite shapes: writing a query, the table names are what they reach
 * for most and a console that hides them is one where every query starts with a guess;
 * reading an answer eleven columns wide, those same seventeen rems are columns of the grid
 * they came for. One press moves between the two, and folded the rail keeps its label down
 * its own spine -- the edge a book on a shelf is read by.
 */
function SchemaRail({ schema }: { schema: SchemaResponse | undefined }): React.JSX.Element | null {
  const { t } = useTranslation();
  const folded = useUiStore((state) => state.lakeRailFolded);
  const toggleRail = useUiStore((state) => state.toggleLakeRail);

  if (schema === undefined || schema.tables.length === 0) {
    // Not an error state worth a slip: the console works without the reference, and a worker
    // that is down already says so where the answer would have been.
    return null;
  }

  return (
    <aside className={folded ? "rail-ref rail-ref--folded" : "rail-ref"}>
      <button className="rail-ref__fold" type="button" aria-expanded={!folded} onClick={toggleRail}>
        <span className="label">{t("lake.consoleTables")}</span>
        {folded ? <ArrowRight /> : <ArrowLeft />}
      </button>
      {folded ? null : <SchemaTables schema={schema} />}
    </aside>
  );
}

/** The tables themselves. Its own component so the rail above stays the fold and nothing else. */
function SchemaTables({ schema }: { schema: SchemaResponse }): React.JSX.Element {
  return (
    <div className="rail-ref__tables">
      {schema.tables.map((table) => (
        // A disclosure, so the list stays scannable at rest and a reader opens the one they
        // are writing against. Native `<details>`: which one is open is not application state.
        <details className="rail-ref__table" key={table.name}>
          <summary className="datum">{table.name}</summary>
          <ul className="rail-ref__columns">
            {table.columns.map((column) => (
              <li key={column.name}>
                <span className="datum">{column.name}</span>
                <span className="datum datum--quiet">{column.type}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
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
    <div className="workbench__foot">
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
        <span className="workbench__warn">{t("lake.consoleNoOrderBy")}</span>
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
      return <p className="note workbench__idle">{t("lake.consoleIdle")}</p>;
    }
    return <ResultTable result={result} locale={locale} fill={true} />;
  }

  return <div className="workbench__answer">{shown()}</div>;
}

/**
 * The head of the workbench: the way back, what this is, and the verb.
 *
 * THE VERB SITS AT THE RIGHT END, over the editor's own right edge, which is where every SQL
 * tool this reader already uses keeps it -- and beside the status it produces, so "it ran" and
 * "this many came back" are one glance rather than two. The chord is printed next to it rather
 * than in a help page, because a shortcut is learnt from the control it replaces.
 *
 * The status says how many rows and which page, because those are the two things a reader
 * cannot work out from the grid itself -- a hundred rows look the same on page one and page
 * four. Nothing else: a bar that also carried the tenant, the login, the row cap and the
 * elapsed time would be four facts nobody reads to find the one they wanted.
 */
function WorkbenchBar({
  tenantId,
  provenance,
  status,
  busy,
  empty,
  run,
}: {
  tenantId: string;
  /** Which stream wrote this query, while it is still the query that was written. */
  provenance: string | null;
  status: string | null;
  busy: boolean;
  empty: boolean;
  run: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <header className="workbench__bar">
      <Link className="plate plate--small" to={divisionPath("lake", tenantId)}>
        <ArrowLeft />
        {t("lake.consoleBack")}
      </Link>
      <h1 className="workbench__title">{t("lake.consoleHead")}</h1>
      {provenance === null ? null : <span className="workbench__from">{provenance}</span>}

      <span className="workbench__status datum datum--quiet">{status}</span>
      <kbd className="workbench__chord">{t("lake.consoleChord")}</kbd>
      <button className="plate plate--primary" type="button" disabled={busy || empty} onClick={run}>
        {t("lake.consoleRun")}
      </button>
    </header>
  );
}

/**
 * What the bar says right now, or nothing at all before the first press.
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

/**
 * Open the console on the stream the address names: write that stream's query, and answer it.
 * Once.
 *
 * ONCE IS THE WHOLE DIFFICULTY. The stream lives in the URL, so it is present on every
 * redraw, not just the one after the press -- and a console that re-seeded on each of them
 * would throw away whatever the reader had typed since. So what has already been opened is
 * recorded, per tenant, and compared before anything is written.
 *
 * The comparison reads the store directly rather than through a selector, because StrictMode
 * invokes an effect twice with the same captured value; a subscribed copy would still be the
 * pre-seed one on the second pass and would ask Postgres the same question again for nothing.
 *
 * Returns the query this stream was opened with, or null -- which is how the bar says where
 * the text came from, and stops saying it the moment a character changes.
 */
function useOpenedStream(
  tenantId: string,
  stream: LakeStream | null,
  ask: (input: { tenantId: string; sql: string; limit: number; offset: number }) => void,
): { key: string; query: string | null } {
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
  }, [tenantId, key, query, ask, setLakeSql, setLakeOpened]);

  return { key, query };
}

/**
 * Where this query came from, while it is still the one that was generated.
 *
 * DERIVED FROM THE TEXT, not remembered: the moment the reader edits a character this stops
 * being true, and so it stops being said. A note kept in state instead would go on claiming
 * the query was generated long after it had been rewritten.
 */
function provenanceOf(
  t: TFunction,
  stream: LakeStream | null,
  generated: string | null,
  sql: string,
): string | null {
  if (stream === null || generated !== sql) {
    return null;
  }
  return t("lake.consoleFromStream", { stream: streamLabel(t, stream) });
}

export function LakeConsole({
  tenantId,
  locale,
  stream,
}: {
  tenantId: string;
  locale: Locale;
  /**
   * The stream the address names, or null when it names none. The console writes this
   * stream's query for itself and answers it; see `useOpenedStream`.
   */
  stream?: LakeStream | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const sql = useUiStore((state) => state.lakeSql[tenantId]) ?? STARTER_SQL;
  const setLakeSql = useUiStore((state) => state.setLakeSql);
  const offset = useUiStore((state) => state.lakeOffset[tenantId]) ?? 0;
  const setLakeOffset = useUiStore((state) => state.setLakeOffset);
  const folded = useUiStore((state) => state.lakeRailFolded);
  const schema = trpc.lake.querySchema.useQuery({ tenantId });
  const run = trpc.lake.query.useMutation();
  const opened = useOpenedStream(tenantId, stream ?? null, run.mutate);

  /** Run from a given row. Every press goes through here, so the page and the rows agree. */
  function runFrom(from: number): void {
    setLakeOffset(tenantId, from);
    run.mutate({ tenantId, sql, limit: PAGE_ROWS, offset: from });
  }

  return (
    <div className={folded ? "workbench workbench--folded" : "workbench"}>
      <SchemaRail schema={schema.data} />

      <div className="workbench__work">
        <WorkbenchBar
          tenantId={tenantId}
          provenance={provenanceOf(t, stream ?? null, opened.query, sql)}
          status={runStatus(t, { running: run.isPending, result: run.data, offset })}
          busy={run.isPending}
          empty={sql.trim() === ""}
          run={(): void => {
            runFrom(0);
          }}
        />

        <div className="workbench__editor">
          <Suspense fallback={<Skeleton rows={4} />}>
            <SqlEditor
              // Remounted per tenant AND per stream opened, never per keystroke: CodeMirror
              // owns the text and a value pushed back on every change would fight the cursor
              // and the history. The stream is in the key because remounting is the only way
              // a new document reaches an uncontrolled editor -- opening a line of the index
              // writes the draft, and this is what makes the editor show it.
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

        <Paging
          sql={sql}
          offset={offset}
          more={run.data?.truncated === true}
          busy={run.isPending}
          goTo={runFrom}
        />
      </div>
    </div>
  );
}
