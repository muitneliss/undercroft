/**
 * How one question is defined: the workbench's left leaf, where an author builds it in the
 * form or writes it as SQL, and the Definition pane every role reads.
 *
 * Split from `QuestionBands.tsx` along what it knows: this file is the only one that knows
 * the two ways a question is written and the one-way door between them.
 */

import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { SchemaView } from "@/api/types.ts";
import { Errata, type ServerError } from "@/components/Errata.tsx";
import { QuestionBuilder } from "@/components/QuestionBuilder.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import type { QuestionDraft } from "@/lib/questionDraft.ts";
import { formatDateTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";

const SqlEditor = lazy(() =>
  import("@/components/SqlEditor.tsx").then((module) => ({ default: module.SqlEditor })),
);

/** What an unsaved question's editor is keyed by, so a new one does not inherit a draft. */
const NEW = "new";

/**
 * The workbench's left leaf: how the question is defined, built in the form or written as
 * SQL. Switching to SQL is one way on purpose -- it starts from the text the builder
 * compiled, so what runs is what was on screen, and there is no second compiler that could
 * disagree with the server's.
 */
export function DefinitionLeaf({
  tenantId,
  draft,
  schema,
  sqlText,
  compileError,
}: {
  tenantId: string;
  draft: QuestionDraft;
  schema: SchemaView;
  sqlText: string;
  compileError: ServerError | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const setQuestionSql = useUiStore((state) => state.setQuestionSql);
  const visual = draft.definition.kind === "visual" ? draft.definition : null;
  const head = visual === null ? t("bi.kindSql") : t("bi.builderHead");

  return (
    <section aria-label={head} className="workbench__leaf">
      <span className="label">{head}</span>
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
    </section>
  );
}

/**
 * The Definition pane, for every role: the SQL the question runs and the facts about it.
 * `sql` is null when the definition does not compile; the run is what says why.
 */
export function DefinitionFacts({
  tenantId,
  draft,
  sql,
  savedAt,
  locale,
}: {
  tenantId: string;
  draft: QuestionDraft;
  sql: string | null;
  /** When the definition was last saved; null for a question never saved. */
  savedAt: string | null;
  locale: "vi" | "en";
}): React.JSX.Element {
  const { t } = useTranslation();
  const table = draft.definition.kind === "visual" ? draft.definition.table : null;

  return (
    <>
      <dl className="facts">
        <dt className="label">{t("bi.factKind")}</dt>
        <dd className="datum">{table === null ? t("bi.kindSql") : t("bi.kindVisual")}</dd>
        <dt className="label">{t("bi.colSaved")}</dt>
        <dd className="datum">{formatDateTime(savedAt, locale)}</dd>
        {/* Only a question built in the form declares its table; SQL is never parsed for
            one (ADR 0092). */}
        {table === null ? null : (
          <>
            <dt className="label">{t("bi.factTable")}</dt>
            <dd className="datum">
              <Link to={`${divisionPath("models", tenantId)}/${encodeURIComponent(table)}`}>
                {table}
              </Link>
            </dd>
          </>
        )}
      </dl>
      <span className="label">{t("bi.compiledHead")}</span>
      {sql === null ? (
        <p className="note">{t("bi.notCompiled")}</p>
      ) : (
        <pre className="payload__text">{sql}</pre>
      )}
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
