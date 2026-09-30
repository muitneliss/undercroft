/**
 * What a question answers, and the Run plate that asks it again: on the reading page in the
 * pane the address names, and on the workbench's right leaf beside how it is drawn. Which
 * way the answer is asked is `useQuestionAnswer`'s.
 *
 * The chart is drawn from the result's own columns, with `raw` values a reader may read, and
 * every role gets the rows that drew it and a CSV of them (`ResultReading`).
 */

import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { ChartOptions } from "@/components/ChartOptions.tsx";
import { Errata } from "@/components/Errata.tsx";
import { DefinitionFacts } from "@/components/QuestionDefinition.tsx";
import { ResultReading } from "@/components/ResultReading.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import type { QuestionAnswer } from "@/components/useQuestionAnswer.ts";
import { questionSql } from "@/lib/params.ts";
import type { QuestionDraft } from "@/lib/questionDraft.ts";
import { paneFromSearch, QUESTION_PANES, type QuestionPane, withPane } from "@/lib/questionPane.ts";
import { useUiStore } from "@/store.ts";

const PANE_KEY = {
  chart: "bi.paneChart",
  data: "bi.paneData",
  definition: "bi.paneDefinition",
} as const satisfies Record<QuestionPane, string>;

/** The Run plate and, when the question did not run, the server's own words for why. */
function RunRow({ reading, busy }: { reading: QuestionAnswer; busy: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <div className="row">
        <button
          className="plate plate--primary"
          disabled={busy || reading.running || !reading.runnable}
          type="button"
          onClick={reading.run}
        >
          {reading.running ? t("bi.running") : t("bi.run")}
        </button>
      </div>
      {reading.error === null ? null : (
        <Errata heading={t("bi.notRun")} live={true} error={reading.error} />
      )}
    </>
  );
}

/**
 * The answer on the reading page, in the pane the address names: the drawing or its rows.
 * A first read in flight is set as type rather than left blank.
 */
function ReadingPane({
  draft,
  reading,
  locale,
  pane,
}: {
  draft: QuestionDraft;
  reading: QuestionAnswer;
  locale: "vi" | "en";
  pane: Exclude<QuestionPane, "definition">;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (reading.result === undefined) {
    return reading.running ? <Skeleton rows={4} /> : null;
  }
  return (
    <ResultReading
      result={reading.result}
      chart={draft.chart}
      locale={locale}
      name={draft.name === "" ? t("bi.untitled") : draft.name}
      pane={pane}
    />
  );
}

/**
 * The workbench's right leaf: Run, how the result is drawn, and the result itself -- the
 * drawing with its rows folded beneath, as an author checks a change against its answer.
 */
export function ResultLeaf({
  draft,
  reading,
  locale,
  busy,
}: {
  draft: QuestionDraft;
  reading: QuestionAnswer;
  locale: "vi" | "en";
  busy: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const setQuestionChart = useUiStore((state) => state.setQuestionChart);
  const { result } = reading;

  return (
    <section aria-label={t("bi.resultHead")} className="workbench__leaf">
      <span className="label">{t("bi.resultHead")}</span>
      <RunRow reading={reading} busy={busy} />
      {result === undefined ? (
        reading.running ? (
          <Skeleton rows={4} />
        ) : null
      ) : (
        <>
          <ChartOptions columns={result.columns} chart={draft.chart} onChange={setQuestionChart} />
          <ResultReading
            result={result}
            chart={draft.chart}
            locale={locale}
            name={draft.name === "" ? t("bi.untitled") : draft.name}
            pane={null}
          />
        </>
      )}
    </section>
  );
}

/**
 * The reading page's answer: the three panes as a plate pair, Run, and the pane the address
 * names. Every pane keeps the rest of the address, so a pane switch keeps the parameters,
 * the way back to a dashboard and a selected point.
 */
export function ReadingBand({
  tenantId,
  draft,
  savedAt,
  locale,
  reading,
  busy,
}: {
  tenantId: string;
  draft: QuestionDraft;
  savedAt: string | null;
  locale: "vi" | "en";
  reading: QuestionAnswer;
  busy: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const pane = paneFromSearch(search);

  return (
    <>
      <Separator className="band-rule" />
      <div className="head">{t("bi.resultHead")}</div>
      <div className="body stack">
        <nav aria-label={t("bi.panesLabel")} className="plateset">
          {QUESTION_PANES.map((candidate) => (
            <Link
              key={candidate}
              className="plate plate--small"
              to={{ search: withPane(search, candidate).toString() }}
              {...(candidate === pane ? { "aria-current": "page" as const } : {})}
            >
              {t(PANE_KEY[candidate])}
            </Link>
          ))}
        </nav>
        {pane === "definition" ? (
          <DefinitionFacts
            tenantId={tenantId}
            draft={draft}
            sql={questionSql(draft.definition)}
            savedAt={savedAt}
            locale={locale}
          />
        ) : (
          <>
            <RunRow reading={reading} busy={busy} />
            <ReadingPane draft={draft} reading={reading} locale={locale} pane={pane} />
          </>
        )}
      </div>
    </>
  );
}
