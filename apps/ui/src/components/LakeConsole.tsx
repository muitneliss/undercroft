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
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

import type { TableResult } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { ResultTable } from "@/components/ResultTable.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
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

export function LakeConsole({
  tenantId,
  locale,
}: {
  tenantId: string;
  locale: Locale;
}): React.JSX.Element {
  const { t } = useTranslation();
  const sql = useUiStore((state) => state.lakeSql[tenantId]) ?? STARTER_SQL;
  const setLakeSql = useUiStore((state) => state.setLakeSql);
  const offset = useUiStore((state) => state.lakeOffset[tenantId]) ?? 0;
  const setLakeOffset = useUiStore((state) => state.setLakeOffset);
  const schema = trpc.lake.querySchema.useQuery({ tenantId });
  const run = trpc.lake.query.useMutation();

  /** Run from a given row. Every press goes through here, so the page and the rows agree. */
  function runFrom(from: number): void {
    setLakeOffset(tenantId, from);
    run.mutate({ tenantId, sql, limit: PAGE_ROWS, offset: from });
  }

  const more = run.data?.truncated === true;
  const rows = run.data?.rows.length ?? 0;

  /** What the bar says right now, or nothing at all before the first press. */
  function status(): string | null {
    if (run.isPending) {
      return t("lake.consoleRunning");
    }
    if (run.data === undefined) {
      return null;
    }
    if (offset === 0) {
      return t("lake.consoleRows", { count: rows });
    }
    return t("lake.consoleRowsFrom", { count: rows, from: offset + 1 });
  }

  return (
    <div className="stack">
      <div className="console">
        <div className="console__work">
          <RunBar
            status={status()}
            busy={run.isPending}
            empty={sql.trim() === ""}
            run={(): void => {
              runFrom(0);
            }}
          />

          <div className="console__editor">
            <Suspense fallback={<Skeleton rows={4} />}>
              <SqlEditor
                // Remounted per tenant, never per keystroke: CodeMirror owns the text and a
                // value pushed back on every change would fight the cursor and the history.
                key={tenantId}
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
