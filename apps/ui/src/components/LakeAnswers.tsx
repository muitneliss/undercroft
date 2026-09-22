/**
 * The answers to one press: a pane per statement, in the order they were written.
 *
 * WHY A PANE PER STATEMENT AND NOT ONE ANSWER. A scratch buffer holds a reader's working
 * set -- "what landed, and what did the extractor make of it" is two questions, and the
 * second is asked to be read BESIDE the first. One answer slot forced them to be asked one at
 * a time, with the previous one gone by the time the next arrived, so the comparison the
 * reader came for happened in their head or not at all.
 *
 * WHY EACH PANE OWNS ITS OWN MUTATION. The alternative is one mutation in the parent and an
 * array of results held somewhere, which is server data in a third home -- the drift
 * `state.md` exists to prevent. A pane that owns its query owns its rows, its refusal and its
 * page, and there is nothing to keep in step. Which page it is on is not stored at all: it is
 * the offset that pane last ASKED for, which its own mutation already remembers.
 *
 * WHY THEY RUN ONE AT A TIME. Not politeness: `createTenantSessions.as` in the worker mints a
 * fresh password for the tenant's dbt role and then opens a pool with it, and one role has
 * one password. Two overlapping queries rotate it twice, and the first connection is refused
 * with an authentication error attributed to the reader's SQL. So the panes share one chain,
 * and a statement asks only when the one before it has settled. The worker-side fix -- a
 * mutex or a retry in that seam, which would also close the schema/query collision the
 * console already has on its first paint -- is a change to the credential path and belongs in
 * its own commit.
 */

import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { TableResult } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { ResultTable } from "@/components/ResultTable.tsx";
import { type LakeRun, type LakeStatement, MAX_STATEMENTS } from "@/lib/statements.ts";
import { trpc } from "@/trpc.ts";

/** How many rows one page holds. The console pages; the author need not write LIMIT. */
const PAGE_ROWS = 100;

/** An `ORDER BY` anywhere in the author's SQL. Paging without one is not stable -- see below. */
const HAS_ORDER_BY = /\border\s+by\b/iu;

/** One page of one statement, as the procedure takes it. */
interface Ask {
  readonly tenantId: string;
  readonly sql: string;
  readonly limit: number;
  readonly offset: number;
}

/** Put a query at the end of the queue. Returns nothing: the pane's own mutation is the result. */
type Enqueue = (task: () => Promise<unknown>) => void;

/**
 * One chain, for every query this column runs.
 *
 * A promise chain rather than a counter and a list of pending work: the ordering IS the data
 * structure, appending is one line, and a task that throws still lets the next one start --
 * a statement that Postgres refused must not strand the statements after it.
 */
function useQueue(): Enqueue {
  const tailRef = useRef<Promise<unknown>>(Promise.resolve());
  return useCallback((task: () => Promise<unknown>): void => {
    tailRef.current = tailRef.current.then(task).catch((): undefined => undefined);
  }, []);
}

/**
 * Ask for one page, when this pane's turn comes and it is still on screen.
 *
 * The liveness check is inside the task rather than around it, because the turn arrives
 * later: a second press unmounts every pane of the previous run while some of its statements
 * are still queued, and those are questions nobody is waiting for an answer to any more.
 */
function askWhenFree(
  enqueue: Enqueue,
  aliveRef: React.RefObject<boolean>,
  mutate: (ask: Ask) => Promise<unknown>,
  ask: Ask,
): void {
  enqueue(async (): Promise<void> => {
    if (aliveRef.current) {
      await mutate(ask);
    }
  });
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
 * What this pane says about itself right now.
 *
 * The two facts a reader cannot get from the grid: how many rows came back, and which page
 * they are. A hundred rows look the same on page one and on page four. A pane that is
 * waiting for the one above it says so rather than looking like one that answered nothing.
 */
function paneStatus(
  t: TFunction,
  state: { running: boolean; refused: boolean; result: TableResult | undefined; offset: number },
): string | null {
  if (state.running) {
    return t("lake.consoleRunning");
  }
  if (state.refused) {
    return null;
  }
  if (state.result === undefined) {
    return t("lake.consoleQueued");
  }
  const count = state.result.rows.length;
  return state.offset === 0
    ? t("lake.consoleRows", { count })
    : t("lake.consoleRowsFrom", { count, from: state.offset + 1 });
}

/** The first line of a statement, for the head that says which one this pane answers. */
function firstLine(sql: string): string {
  return sql.split("\n", 1)[0] ?? sql;
}

/**
 * One statement's answer: its own query, its own rows, its own page.
 *
 * It asks once on mount and again only when the reader turns a page. The latch is what makes
 * "once" true under StrictMode, which mounts, tears down and mounts again -- without it the
 * console would ask Postgres the same question twice in development and nowhere else, which
 * is the kind of difference that is found in production.
 */
function StatementPane({
  tenantId,
  locale,
  statement,
  ordinal,
  numbered,
  enqueue,
}: {
  tenantId: string;
  locale: Locale;
  statement: LakeStatement;
  ordinal: number;
  /** Whether to name which statement this is. One statement needs no number. */
  numbered: boolean;
  enqueue: Enqueue;
}): React.JSX.Element {
  const { t } = useTranslation();
  const ask = trpc.lake.query.useMutation();
  const aliveRef = useRef(false);
  const askedRef = useRef(false);
  const { mutateAsync } = ask;
  const offset = ask.variables?.offset ?? 0;

  useEffect(() => {
    aliveRef.current = true;
    if (!askedRef.current) {
      askedRef.current = true;
      askWhenFree(enqueue, aliveRef, mutateAsync, {
        tenantId,
        sql: statement.sql,
        limit: PAGE_ROWS,
        offset: 0,
      });
    }
    return (): void => {
      aliveRef.current = false;
    };
  }, [enqueue, mutateAsync, tenantId, statement.sql]);

  function shown(): React.JSX.Element {
    if (ask.isError) {
      return (
        <Errata heading={t("lake.consoleRefused")} live={true}>
          {ask.error.message}
        </Errata>
      );
    }
    if (ask.data === undefined) {
      return <p className="note workbench__idle">{t("lake.consoleWaiting")}</p>;
    }
    return <ResultTable result={ask.data} locale={locale} fill={true} />;
  }

  return (
    <section className="workbench__pane">
      <header className="workbench__paneline">
        {numbered ? (
          <span className="workbench__which">{t("lake.consoleStatement", { n: ordinal })}</span>
        ) : null}
        <span className="workbench__excerpt">{firstLine(statement.sql)}</span>
        <span className="workbench__status datum datum--quiet">
          {paneStatus(t, {
            running: ask.isPending,
            refused: ask.isError,
            result: ask.data,
            offset,
          })}
        </span>
      </header>

      <div className="workbench__rows">{shown()}</div>

      <Paging
        sql={statement.sql}
        offset={offset}
        more={ask.data?.truncated === true}
        busy={ask.isPending}
        goTo={(from): void => {
          askWhenFree(enqueue, aliveRef, mutateAsync, {
            tenantId,
            sql: statement.sql,
            limit: PAGE_ROWS,
            offset: from,
          });
        }}
      />
    </section>
  );
}

/**
 * The answer region: every answer to the last press, or the sentence saying there has not
 * been one, stacked in the order the statements were written.
 *
 * Exported and free of the editor, so a test can render the answers over a fetch that models
 * `lake.query` without a CodeMirror instance in a headless DOM.
 *
 * A PRESS RE-RUNS EVERYTHING, and nothing here has to arrange that: a run numbers its
 * statements, so every pane of the new run is a new `key` and mounts -- while the panes of
 * the old one unmount, and the queries they had queued find themselves unwanted and are
 * skipped. The queue itself deliberately survives the press, so a query still in flight is
 * still the one thing talking to the tenant's login.
 */
export function ResultPanels({
  tenantId,
  locale,
  run,
}: {
  tenantId: string;
  locale: Locale;
  /** What the last press committed, or nothing at all before the first one. */
  run: LakeRun | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const enqueue = useQueue();

  if (run === undefined) {
    return (
      <div className="workbench__answer">
        <p className="note workbench__idle">{t("lake.consoleIdle")}</p>
      </div>
    );
  }

  return (
    <div className="workbench__answer">
      {run.statements.map((statement, index) => (
        <StatementPane
          key={statement.id}
          tenantId={tenantId}
          locale={locale}
          statement={statement}
          ordinal={index + 1}
          numbered={run.statements.length > 1}
          enqueue={enqueue}
        />
      ))}

      {/* WHAT WAS NOT RUN IS SAID. A buffer past the cap is a reader's working set, most of
          it older questions; running all of it is not what the press meant, and dropping the
          rest in silence would leave them reading an absence as an empty answer. */}
      {run.skipped > 0 ? (
        <p className="note workbench__warn">
          {t("lake.consoleCapped", { skipped: run.skipped, ran: MAX_STATEMENTS })}
        </p>
      ) : null}
    </div>
  );
}
