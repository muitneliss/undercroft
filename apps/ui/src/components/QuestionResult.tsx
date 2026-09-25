/**
 * Run, Save, and what came back.
 *
 * An author runs the definition on screen (`bi.answer`); a viewer runs the SAVED question by
 * id (`bi.runQuestion`), because a viewer must not be able to send a definition of their own.
 * That is why there are two mutations rather than one with a flag, and it is a boundary
 * rather than a convenience -- the server refuses either way.
 *
 * The chart is drawn from the result's own columns, with `raw` values a reader may read; the
 * charting library rides in its own chunk, fetched the first time a result is drawn.
 */

import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";

import { ChartOptions } from "@/components/ChartOptions.tsx";
import { Errata } from "@/components/Errata.tsx";
import type { BoundParams } from "@/components/QuestionBands.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { isQuestionDirty, type QuestionDraft } from "@/lib/questionDraft.ts";
import { useUiStore } from "@/store.ts";
import type { trpc } from "@/trpc.ts";

const ChartFrame = lazy(() =>
  import("@/components/charts/ChartFrame.tsx").then((module) => ({ default: module.ChartFrame })),
);

type Answer = ReturnType<typeof trpc.bi.answer.useMutation>;
type RunSaved = ReturnType<typeof trpc.bi.runQuestion.useMutation>;
type Save = ReturnType<typeof trpc.bi.questions.save.useMutation>;

/** What Run and Save do, held together because one request at a time is a page-wide fact. */
export interface QuestionActions {
  readonly answer: Answer;
  readonly runSaved: RunSaved;
  readonly save: Save;
  readonly busy: boolean;
}

/**
 * Run, Save, and what came back.
 *
 * An author runs the definition on screen (`bi.answer`); a viewer runs the SAVED question by
 * id (`bi.runQuestion`), because a viewer must not be able to send a definition of their own.
 * That is why there are two mutations rather than one with a flag.
 */
export function ResultBand({
  tenantId,
  draft,
  canAuthor,
  locale,
  bound,
  actions,
}: {
  tenantId: string;
  draft: QuestionDraft;
  canAuthor: boolean;
  locale: "vi" | "en";
  bound: BoundParams;
  actions: QuestionActions;
}): React.JSX.Element {
  const { t } = useTranslation();
  const setQuestionChart = useUiStore((state) => state.setQuestionChart);
  const { answer, runSaved, save, busy } = actions;

  const result = canAuthor ? answer.data : runSaved.data;
  const runError = canAuthor ? answer.error : runSaved.error;
  const running = answer.isPending || runSaved.isPending;

  function run(): void {
    if (bound.missing.length > 0) {
      return;
    }
    if (canAuthor) {
      answer.mutate({ tenantId, definition: draft.definition, params: bound.params });
    } else if (draft.id !== null) {
      runSaved.mutate({ tenantId, questionId: draft.id, params: bound.params });
    }
  }

  return (
    <>
      <Separator className="band-rule" />
      <div className="head">{t("bi.resultHead")}</div>
      <div className="body stack">
        <div className="row">
          <button
            className="plate plate--primary"
            disabled={busy || bound.missing.length > 0 || (!canAuthor && draft.id === null)}
            type="button"
            onClick={run}
          >
            {running ? t("bi.running") : t("bi.run")}
          </button>
          {canAuthor ? (
            <SaveButton tenantId={tenantId} draft={draft} save={save} busy={busy} />
          ) : null}
        </div>
        {runError === null || runError === undefined ? null : (
          <Errata heading={t("bi.notRun")} live={true} error={runError} />
        )}
        {save.isError ? <Errata heading={t("bi.notSaved")} live={true} error={save.error} /> : null}
        {result === undefined ? null : (
          <>
            {canAuthor ? (
              <ChartOptions
                columns={result.columns}
                chart={draft.chart}
                onChange={setQuestionChart}
              />
            ) : null}
            <Suspense fallback={<Skeleton rows={4} />}>
              <ChartFrame result={result} chart={draft.chart} locale={locale} />
            </Suspense>
          </>
        )}
      </div>
    </>
  );
}

/** Save, and whether there is anything to save. An untitled question is saved as "untitled". */
function SaveButton({
  tenantId,
  draft,
  save,
  busy,
}: {
  tenantId: string;
  draft: QuestionDraft;
  save: Save;
  busy: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const dirty = isQuestionDirty(draft);

  return (
    <>
      <button
        className="plate"
        disabled={busy || !dirty}
        type="button"
        onClick={(): void => {
          save.mutate({
            tenantId,
            ...(draft.id === null ? {} : { id: draft.id }),
            name: draft.name === "" ? t("bi.untitled") : draft.name,
            definition: draft.definition,
            chart: draft.chart,
          });
        }}
      >
        {save.isPending ? t("bi.saving") : t("bi.save")}
      </button>
      {dirty ? (
        <span className="datum datum--quiet">{t("bi.unsaved")}</span>
      ) : save.isSuccess ? (
        <span className="datum datum--quiet" role="status">
          {t("bi.savedNote")}
        </span>
      ) : null}
    </>
  );
}
