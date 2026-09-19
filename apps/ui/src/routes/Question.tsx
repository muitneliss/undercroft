/**
 * One question, open: built in the form or written as SQL, run, and saved.
 *
 * The draft lives in the store, seeded once per question and kept, as the model draft is.
 * The compiled SQL is shown beside the builder from the server's one compiler, so what the
 * author sees is exactly what will run; switching to SQL mode starts from that text and is
 * one way. Parameters -- `{{name}}` holes -- take their values from the URL, so a run with
 * a filter set is a link, and a run with a hole unfilled is refused before it is sent.
 *
 * Run answers as the tenant's read-only login through the worker; the result is drawn by
 * the one result table, a numeric with every digit. A viewer may run a saved question and
 * see no builder; a member or an admin authors.
 */

import { paramNames } from "@undercroft/contracts/bi";
import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ChartOptions } from "@/components/ChartOptions.tsx";
import { Errata } from "@/components/Errata.tsx";
import { QuestionBuilder } from "@/components/QuestionBuilder.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { paramsFromSearch, withParam } from "@/lib/params.ts";
import {
  draftFromQuestion,
  isQuestionDirty,
  newQuestionDraft,
  type QuestionDraft,
} from "@/lib/questionDraft.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const SqlEditor = lazy(() =>
  import("@/components/SqlEditor.tsx").then((module) => ({ default: module.SqlEditor })),
);
// The charting library rides in its own chunk, fetched the first time a result is drawn.
const ChartFrame = lazy(() =>
  import("@/components/charts/ChartFrame.tsx").then((module) => ({ default: module.ChartFrame })),
);

const NEW = "new";

export function Question({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const params = useParams();
  const id = params.id ?? NEW;
  const isNew = id === NEW;
  const locale = useUiStore((state) => state.locale);
  const draft = useUiStore((state) => state.questionDraft);
  const setQuestionDraft = useUiStore((state) => state.setQuestionDraft);
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const tenant = trpc.tenants.get.useQuery({ tenantId });
  const schema = trpc.bi.schema.useQuery({ tenantId });
  const question = trpc.bi.questions.get.useQuery({ tenantId, id }, { enabled: !isNew });

  // Seed once per question. A new question waits for the schema, to start from its first
  // table; a saved one waits for itself. A draft already held for it is kept.
  const held =
    draft !== null && draft.tenantId === tenantId && (isNew ? draft.id === null : draft.id === id)
      ? draft
      : null;
  useEffect(() => {
    if (held !== null) {
      return;
    }
    if (isNew) {
      if (schema.data !== undefined) {
        setQuestionDraft(newQuestionDraft(tenantId, schema.data.tables[0]?.name ?? null));
      }
      return;
    }
    if (question.data !== undefined) {
      setQuestionDraft(draftFromQuestion(tenantId, question.data));
    }
  }, [held, isNew, schema.data, question.data, tenantId, setQuestionDraft]);

  if (tenant.isPending || schema.isPending || (!isNew && question.isPending)) {
    return <Skeleton rows={6} />;
  }
  if (tenant.isError || schema.isError || question.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("bi.questionNotLoaded")}
      </Errata>
    );
  }
  if (held === null) {
    return <Skeleton rows={6} />;
  }

  const canAuthor = tenant.data.role !== "viewer";
  return (
    <QuestionLeaf
      tenantId={tenantId}
      draft={held}
      schema={schema.data}
      canAuthor={canAuthor}
      locale={locale}
      onSaved={async (savedId): Promise<void> => {
        await utils.bi.questions.list.invalidate({ tenantId });
        await utils.bi.questions.get.invalidate({ tenantId, id: savedId });
        if (isNew) {
          void navigate(`${divisionPath("reports", tenantId)}/questions/${savedId}`, {
            replace: true,
          });
        }
      }}
      onDeleted={async (): Promise<void> => {
        setQuestionDraft(null);
        await utils.bi.questions.list.invalidate({ tenantId });
        void navigate(divisionPath("reports", tenantId));
      }}
    />
  );
}

function QuestionLeaf({
  tenantId,
  draft,
  schema,
  canAuthor,
  locale,
  onSaved,
  onDeleted,
}: {
  tenantId: string;
  draft: QuestionDraft;
  schema: { tables: { name: string; columns: { name: string; type: string }[] }[] };
  canAuthor: boolean;
  locale: "vi" | "en";
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const setQuestionName = useUiStore((state) => state.setQuestionName);
  const patchQuestionVisual = useUiStore((state) => state.patchQuestionVisual);
  const setQuestionSql = useUiStore((state) => state.setQuestionSql);
  const switchQuestionToSql = useUiStore((state) => state.switchQuestionToSql);
  const markQuestionSaved = useUiStore((state) => state.markQuestionSaved);
  const setQuestionChart = useUiStore((state) => state.setQuestionChart);

  const visual = draft.definition.kind === "visual" ? draft.definition : null;
  const compiled = trpc.bi.compile.useQuery(
    { tenantId, definition: draft.definition },
    { enabled: canAuthor && visual !== null },
  );
  const written = draft.definition.kind === "sql" ? draft.definition.sql : null;
  const sqlText = written ?? compiled.data?.sql ?? "";
  const names = paramNames(sqlText);
  const bound = paramsFromSearch(search, names);

  const answer = trpc.bi.answer.useMutation();
  const runSaved = trpc.bi.runQuestion.useMutation();
  const save = trpc.bi.questions.save.useMutation({
    onSuccess: async (saved) => {
      markQuestionSaved(saved.id);
      await onSaved(saved.id);
    },
  });
  const remove = trpc.bi.questions.delete.useMutation({ onSuccess: onDeleted });

  const dirty = isQuestionDirty(draft);
  const busy = answer.isPending || runSaved.isPending || save.isPending || remove.isPending;
  const result = canAuthor ? answer.data : runSaved.data;
  const runError = canAuthor ? answer.error : runSaved.error;
  const base = divisionPath("reports", tenantId);

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
    <div className="sheet">
      <div className="head head--division">{t("reports.head")}</div>
      <div className="body stack">
        <p className="prose">
          <Link className="plate plate--small" to={base}>
            {t("bi.backToReports")}
          </Link>
        </p>
        <h1>{draft.name === "" ? t("bi.untitled") : draft.name}</h1>

        {canAuthor ? (
          <div className="field">
            <label className="label" htmlFor="q-name">
              {t("bi.nameLabel")}
            </label>
            <input
              autoComplete="off"
              className="input"
              id="q-name"
              maxLength={120}
              placeholder={t("bi.namePlaceholder")}
              type="text"
              value={draft.name}
              onChange={(event): void => {
                setQuestionName(event.currentTarget.value);
              }}
            />
          </div>
        ) : (
          <p className="note">{draft.id === null ? t("bi.viewerNew") : t("bi.viewerNote")}</p>
        )}
      </div>

      {canAuthor ? (
        <>
          <div className="band-rule" />
          <div className="head">{visual === null ? t("bi.kindSql") : t("bi.builderHead")}</div>
          <div className="body stack">
            {visual === null ? (
              <Suspense fallback={<Skeleton rows={6} />}>
                <SqlEditor
                  key={`${tenantId}/${draft.id ?? NEW}`}
                  value={written ?? ""}
                  onChange={setQuestionSql}
                  label={t("bi.sqlLabel")}
                />
              </Suspense>
            ) : schema.tables.length === 0 ? (
              <>
                <p className="note">{t("bi.noTables")}</p>
                <div className="row">
                  <button
                    className="plate"
                    type="button"
                    onClick={(): void => {
                      switchQuestionToSql(sqlText === "" ? "select 1 as n" : sqlText);
                    }}
                  >
                    {t("bi.switchToSql")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <QuestionBuilder
                  schema={schema}
                  definition={visual}
                  onPatch={patchQuestionVisual}
                />
                <span className="label">{t("bi.compiledHead")}</span>
                {compiled.isError ? (
                  <Errata heading={t("common.notLoaded")}>{compiled.error.message}</Errata>
                ) : (
                  <pre className="payload__text">{sqlText}</pre>
                )}
                <div className="row">
                  <button
                    className="plate"
                    disabled={sqlText === ""}
                    title={t("bi.switchHint")}
                    type="button"
                    onClick={(): void => {
                      switchQuestionToSql(sqlText);
                    }}
                  >
                    {t("bi.switchToSql")}
                  </button>
                  <span className="datum datum--quiet">{t("bi.switchHint")}</span>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="band-rule" />
          <div className="head">{t("bi.compiledHead")}</div>
          <div className="body stack">
            <pre className="payload__text">{sqlText}</pre>
          </div>
        </>
      )}

      {names.length > 0 ? (
        <>
          <div className="band-rule" />
          <div className="head">{t("bi.paramsHead")}</div>
          <div className="body stack">
            <p className="prose">{t("bi.paramsLead")}</p>
            <form
              className="row"
              onSubmit={(event): void => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                let next = search;
                for (const name of names) {
                  next = withParam(next, name, String(data.get(name) ?? "").trim());
                }
                setSearch(next);
              }}
            >
              {names.map((name) => (
                <div key={name} className="field">
                  <label className="label" htmlFor={`q-param-${name}`}>
                    {name}
                  </label>
                  <input
                    autoComplete="off"
                    className="input"
                    defaultValue={bound.params[name] ?? ""}
                    id={`q-param-${name}`}
                    key={`${name}=${bound.params[name] ?? ""}`}
                    name={name}
                    type="text"
                  />
                </div>
              ))}
              <button className="plate" type="submit">
                {t("bi.applyParams")}
              </button>
            </form>
            {bound.missing.length > 0 ? <p className="note">{t("bi.paramMissing")}</p> : null}
          </div>
        </>
      ) : null}

      <div className="band-rule" />
      <div className="head">{t("bi.resultHead")}</div>
      <div className="body stack">
        <div className="row">
          <button
            className="plate plate--primary"
            disabled={busy || bound.missing.length > 0 || (!canAuthor && draft.id === null)}
            type="button"
            onClick={run}
          >
            {answer.isPending || runSaved.isPending ? t("bi.running") : t("bi.run")}
          </button>
          {canAuthor ? (
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
          ) : null}
        </div>
        {runError === null || runError === undefined ? null : (
          <Errata heading={t("bi.notRun")} live={true}>
            {runError.message}
          </Errata>
        )}
        {save.isError ? (
          <Errata heading={t("bi.notSaved")} live={true}>
            {save.error.message}
          </Errata>
        ) : null}
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

      {canAuthor && draft.id !== null ? (
        <>
          <div className="band-rule" />
          <div className="head">{t("bi.deleteHead")}</div>
          <div className="body stack">
            <p className="prose">{t("bi.deleteLead", { name: draft.name })}</p>
            <details className="tokenform">
              <summary className="plate">{t("bi.deleteHead")}</summary>
              <div className="hinge stack">
                <button
                  className="plate plate--primary"
                  disabled={busy}
                  type="button"
                  onClick={(): void => {
                    if (draft.id !== null) {
                      remove.mutate({ tenantId, id: draft.id });
                    }
                  }}
                >
                  {remove.isPending ? t("bi.deleting") : t("bi.deleteConfirm")}
                </button>
                {remove.isError ? (
                  <Errata heading={t("bi.notDeleted")} live={true}>
                    {remove.error.message}
                  </Errata>
                ) : null}
              </div>
            </details>
          </div>
        </>
      ) : null}
    </div>
  );
}
