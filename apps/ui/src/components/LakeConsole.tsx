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
 * WHAT A PRESS MEANS. The buffer is a script rather than a query: a reader keeps their
 * working set in it, and two statements are two questions asked to be read beside each other.
 * So Run splits the text at its top-level semicolons and commits the statements as one run,
 * which `ResultPanels` answers a pane at a time. With a SELECTION, the press means the
 * selection and nothing else -- the gesture that makes a scratch buffer usable at all,
 * because it is how a reader re-asks one of five questions without deleting the other four.
 *
 * The draft lives in the store, keyed by tenant (`state.md`); CodeMirror owns its own
 * document and is uncontrolled, exactly as the model editor drives it.
 */

import { useIsMutating } from "@tanstack/react-query";
import { getMutationKey } from "@trpc/react-query";
import type { SchemaResponse } from "@undercroft/contracts";
import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";
import { lazy, Suspense, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ArrowLeft, ArrowRight } from "@/components/Icon.tsx";
import { ResultPanels } from "@/components/LakeAnswers.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import type { SqlEditorHandle } from "@/components/SqlEditor.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { type LakeStream, streamKey, streamLabel, streamQuery } from "@/lib/lake.ts";
import type { LakeRun } from "@/lib/statements.ts";
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
 * The head of the workbench: the way back, what this is, and the verb.
 *
 * THE VERB SITS AT THE RIGHT END, over the editor's own right edge, which is where every SQL
 * tool this reader already uses keeps it. The chord is printed next to it rather than in a
 * help page, because a shortcut is learnt from the control it replaces.
 *
 * THE ROW COUNT IS NOT HERE ANY MORE, and that is the one thing that moved: a press can put
 * several answers on screen, and a bar cannot say "a hundred rows" about three of them. Each
 * pane carries its own count, on the line above the grid it counts -- which is beside the
 * thing it describes rather than at the far end of a toolbar. What the bar still says is
 * whether anything is running, because that is a fact about the press and not about a pane.
 */
function WorkbenchBar({
  tenantId,
  provenance,
  busy,
  empty,
  run,
}: {
  tenantId: string;
  /** Which stream wrote this query, or that a selection was run, while either is still true. */
  provenance: string | null;
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

      <span className="workbench__status datum datum--quiet">
        {busy ? t("lake.consoleRunning") : null}
      </span>
      <kbd className="workbench__chord">{t("lake.consoleChord")}</kbd>
      <button className="plate plate--primary" type="button" disabled={busy || empty} onClick={run}>
        {t("lake.consoleRun")}
      </button>
    </header>
  );
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
): { key: string; query: string | null } {
  const setLakeSql = useUiStore((state) => state.setLakeSql);
  const setLakeOpened = useUiStore((state) => state.setLakeOpened);
  const startLakeRun = useUiStore((state) => state.startLakeRun);
  const key = stream === null ? "" : streamKey(stream);
  const query = stream === null ? null : streamQuery(stream);

  useEffect(() => {
    if (query === null || useUiStore.getState().lakeOpened[tenantId] === key) {
      return;
    }
    setLakeOpened(tenantId, key);
    setLakeSql(tenantId, query);
    // The run is committed INSIDE the guard, with the seeding: a second run minted on the
    // second pass of a StrictMode effect would carry new pane ids, and every pane would ask
    // Postgres its question again.
    startLakeRun(tenantId, query, false);
  }, [tenantId, key, query, setLakeSql, setLakeOpened, startLakeRun]);

  return { key, query };
}

/**
 * Where what is on screen came from: a selection, or a stream's generated query.
 *
 * ONE SLOT, ONE FACT. The bar has room for one note, and the two answers cannot both be the
 * most useful: a reader who ran a selection is looking at an answer to part of their buffer,
 * which is the thing they most need said back to them, so it wins.
 *
 * The stream half is DERIVED FROM THE TEXT rather than remembered -- the moment the reader
 * edits a character it stops being true, and so it stops being said. A note kept in state
 * would go on claiming the query was generated long after it had been rewritten.
 */
function provenanceOf(
  t: TFunction,
  state: {
    stream: LakeStream | null;
    generated: string | null;
    sql: string;
    run: LakeRun | undefined;
  },
): string | null {
  if (state.run?.fromSelection === true) {
    return t("lake.consoleFromSelection");
  }
  if (state.stream === null || state.generated !== state.sql) {
    return null;
  }
  return t("lake.consoleFromStream", { stream: streamLabel(t, state.stream) });
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
  const run = useUiStore((state) => state.lakeRun[tenantId]);
  const startLakeRun = useUiStore((state) => state.startLakeRun);
  const folded = useUiStore((state) => state.lakeRailFolded);
  const schema = trpc.lake.querySchema.useQuery({ tenantId });
  const editorRef = useRef<SqlEditorHandle>(null);
  const opened = useOpenedStream(tenantId, stream ?? null);
  // Every pane's query carries the same mutation key, so this is the one place that knows a
  // press is still being answered -- without it a second press would start a second run
  // alongside the first, and two queries for one tenant collide at the worker's login.
  const busy = useIsMutating({ mutationKey: getMutationKey(trpc.lake.query) }) > 0;

  /**
   * Commit a run. The selection is what the press MEANT when there is one; the whole buffer
   * is what it meant when there is not.
   */
  function press(selected: string | null): void {
    startLakeRun(tenantId, selected ?? sql, selected !== null);
  }

  return (
    <div className={folded ? "workbench workbench--folded" : "workbench"}>
      <SchemaRail schema={schema.data} />

      <div className="workbench__work">
        <WorkbenchBar
          tenantId={tenantId}
          provenance={provenanceOf(t, {
            stream: stream ?? null,
            generated: opened.query,
            sql,
            run,
          })}
          busy={busy}
          empty={sql.trim() === ""}
          run={(): void => {
            // The button is not inside CodeMirror, so it asks the editor what is selected --
            // the same question the chord answers for itself from the view it is given.
            press(editorRef.current?.selectedText() ?? null);
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
              ref={editorRef}
              value={sql}
              onChange={(next): void => {
                setLakeSql(tenantId, next);
              }}
              onSubmit={press}
              label={t("lake.consoleSqlLabel")}
              {...(schema.data === undefined ? {} : { schema: schema.data })}
            />
          </Suspense>
        </div>

        <ResultPanels tenantId={tenantId} locale={locale} run={run} />
      </div>
    </div>
  );
}
