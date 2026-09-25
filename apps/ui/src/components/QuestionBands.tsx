/**
 * The bands one open question is set in: its name, its definition, its parameters, its
 * result, and the one that deletes it.
 *
 * Split out of `routes/Question.tsx`, which held the whole leaf in one function. The split
 * follows the rules on the page: each band is a separate decision with its own head, and the
 * route above composes them and owns the mutations they share -- `busy` means "one request is
 * in flight", and it has to mean that across every band or two of them race.
 *
 * Nothing here interpolates a parameter into SQL. `{{name}}` holes are collected from the
 * compiled text, filled from the URL, and bound by the server; a hole left empty refuses the
 * run before it is sent rather than running a query with a blank in it.
 */

import { Suspense, lazy, useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import type { SchemaView } from "@/api/types.ts";
import { Errata, type ServerError } from "@/components/Errata.tsx";
import { QuestionBuilder } from "@/components/QuestionBuilder.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import type { QuestionDraft } from "@/lib/questionDraft.ts";
import { divisionPath } from "@/lib/divisions.ts";
import { withParam } from "@/lib/params.ts";
import { useUiStore } from "@/store.ts";
import type { trpc } from "@/trpc.ts";

const SqlEditor = lazy(() =>
  import("@/components/SqlEditor.tsx").then((module) => ({ default: module.SqlEditor })),
);

/** What an unsaved question's editor is keyed by, so a new one does not inherit a draft. */
const NEW = "new";

/** The parameters a run needs, as `paramsFromSearch` resolved them against the URL. */
export interface BoundParams {
  readonly params: Record<string, string>;
  readonly missing: readonly string[];
}

type Remove = ReturnType<typeof trpc.bi.questions.delete.useMutation>;

/** The question's title and, for an author, the field that changes it. */
export function QuestionHead({
  tenantId,
  draft,
  canAuthor,
}: {
  tenantId: string;
  draft: QuestionDraft;
  canAuthor: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const qNameId = useId();
  const setQuestionName = useUiStore((state) => state.setQuestionName);

  return (
    <div className="body stack">
      <p className="prose">
        <Link className="plate plate--small" to={divisionPath("reports", tenantId)}>
          {t("bi.backToReports")}
        </Link>
      </p>
      <h1>{draft.name === "" ? t("bi.untitled") : draft.name}</h1>

      {canAuthor ? (
        <div className="field">
          <label className="label" htmlFor={qNameId}>
            {t("bi.nameLabel")}
          </label>
          <input
            autoComplete="off"
            className="input"
            id={qNameId}
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
  );
}

/**
 * How the question is defined: built in the form, or written as SQL.
 *
 * A viewer sees the compiled text and no editor. Switching to SQL is one way on purpose --
 * it starts from the text the builder compiled, so what runs is what was on screen, and
 * there is no second compiler that could disagree with the server's.
 */
export function DefinitionBand({
  tenantId,
  draft,
  schema,
  canAuthor,
  sqlText,
  compileError,
}: {
  tenantId: string;
  draft: QuestionDraft;
  schema: SchemaView;
  canAuthor: boolean;
  sqlText: string;
  compileError: ServerError | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const setQuestionSql = useUiStore((state) => state.setQuestionSql);
  const visual = draft.definition.kind === "visual" ? draft.definition : null;

  if (!canAuthor) {
    return (
      <>
        <Separator className="band-rule" />
        <div className="head">{t("bi.compiledHead")}</div>
        <div className="body stack">
          <pre className="payload__text">{sqlText}</pre>
        </div>
      </>
    );
  }

  return (
    <>
      <Separator className="band-rule" />
      <div className="head">{visual === null ? t("bi.kindSql") : t("bi.builderHead")}</div>
      <div className="body stack">
        {visual === null ? (
          <Suspense fallback={<Skeleton rows={6} />}>
            <SqlEditor
              key={`${tenantId}/${draft.id ?? NEW}`}
              value={draft.definition.kind === "sql" ? draft.definition.sql : ""}
              onChange={setQuestionSql}
              label={t("bi.sqlLabel")}
            />
          </Suspense>
        ) : (
          <VisualDefinitionBand
            schema={schema}
            visual={visual}
            sqlText={sqlText}
            compileError={compileError}
          />
        )}
      </div>
    </>
  );
}

/** The builder, the SQL it compiles to, and the one-way door out of it. */
function VisualDefinitionBand({
  schema,
  visual,
  sqlText,
  compileError,
}: {
  schema: SchemaView;
  visual: Extract<QuestionDraft["definition"], { kind: "visual" }>;
  sqlText: string;
  compileError: ServerError | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const patchQuestionVisual = useUiStore((state) => state.patchQuestionVisual);
  const switchQuestionToSql = useUiStore((state) => state.switchQuestionToSql);

  if (schema.tables.length === 0) {
    return (
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
    );
  }

  return (
    <>
      <QuestionBuilder schema={schema} definition={visual} onPatch={patchQuestionVisual} />
      <span className="label">{t("bi.compiledHead")}</span>
      {compileError === null ? (
        <pre className="payload__text">{sqlText}</pre>
      ) : (
        <Errata heading={t("common.notLoaded")} error={compileError} />
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
  );
}

/**
 * The `{{name}}` holes, filled from the URL.
 *
 * The URL is the owner, not a field: a run with its filters set is then a link somebody can
 * paste to a colleague, and a reload lands on the same answer. Each input is keyed by its
 * current value so that following such a link re-renders the box rather than leaving what
 * was typed before standing over a different parameter.
 */
export function ParamsBand({
  names,
  bound,
}: {
  names: readonly string[];
  bound: BoundParams;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();

  if (names.length === 0) {
    return null;
  }

  return (
    <>
      <Separator className="band-rule" />
      <div className="head">{t("bi.paramsHead")}</div>
      <div className="body stack">
        <p className="prose">{t("bi.paramsLead")}</p>
        <form
          className="row row--field"
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
  );
}

/** Deleting a saved question, behind a disclosure so it is not one press away. */
export function DeleteBand({
  tenantId,
  draft,
  canAuthor,
  busy,
  remove,
}: {
  tenantId: string;
  draft: QuestionDraft;
  canAuthor: boolean;
  busy: boolean;
  remove: Remove;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const { id } = draft;

  if (!canAuthor || id === null) {
    return null;
  }

  return (
    <>
      <Separator className="band-rule" />
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
                remove.mutate({ tenantId, id });
              }}
            >
              {remove.isPending ? t("bi.deleting") : t("bi.deleteConfirm")}
            </button>
            {remove.isError ? (
              <Errata heading={t("bi.notDeleted")} live={true} error={remove.error} />
            ) : null}
          </div>
        </details>
      </div>
    </>
  );
}
