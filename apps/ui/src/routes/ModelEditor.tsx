/**
 * One model, open: its SQL in the editor, its tests as a form, and the three verbs.
 *
 * Save stores what is on screen and executes nothing. Build runs dbt for this model alone,
 * from the SAVED version, and answers with the run's steps and the table's first rows read
 * as the tenant's own read-only login -- proof that a dashboard can see it, not only its
 * author. Delete removes the row; the built table stays until the next build, and the leaf
 * says so.
 *
 * The draft lives in the store, seeded from the server the first time this model is opened
 * and kept after: an author who switches to the journal to read a failed build and comes
 * back finds their edits where they left them, and the list names the model as unsaved
 * until they save. "Unsaved" is a comparison against a snapshot of what the server holds,
 * never a flag. The editor itself is uncontrolled and remounted by key when the model
 * changes; the store hears every keystroke and owns the text.
 *
 * A member or viewer reads the saved SQL and sees no verb. Courtesy; the server refuses
 * regardless.
 */

import { TEST_KINDS } from "@undercroft/contracts/models";
import { lazy, Suspense, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import type { BuildResult } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { ResultTable } from "@/components/ResultTable.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { StepsTable } from "@/components/StepsTable.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { draftFrom, isDirty, type ModelDraft, testsFor } from "@/lib/modelDraft.ts";
import { isModelName } from "@/lib/modelName.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const SqlEditor = lazy(() =>
  import("@/components/SqlEditor.tsx").then((module) => ({ default: module.SqlEditor })),
);

/** Which catalogue key names each test kind's column in the tests table. */
const TEST_HEAD = { not_null: "models.colNotNull", unique: "models.colUnique" } as const;

export function ModelEditor({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const params = useParams();
  const name = params.name ?? "";
  const locale = useUiStore((state) => state.locale);
  const draft = useUiStore((state) => state.modelDraft);
  const setModelDraft = useUiStore((state) => state.setModelDraft);
  const setModelSql = useUiStore((state) => state.setModelSql);
  const markModelSaved = useUiStore((state) => state.markModelSaved);
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const model = trpc.models.get.useQuery({ tenantId, name }, { enabled: name !== "" });
  const tenant = trpc.tenants.get.useQuery({ tenantId });

  const save = trpc.models.save.useMutation({
    onSuccess: async () => {
      markModelSaved();
      await utils.models.get.invalidate({ tenantId, name });
      await utils.models.list.invalidate({ tenantId });
    },
  });
  const build = trpc.models.build.useMutation({
    onSuccess: async () => {
      // The last build and the columns it found are on the model now.
      await utils.models.get.invalidate({ tenantId, name });
      await utils.models.list.invalidate({ tenantId });
    },
  });
  const remove = trpc.models.delete.useMutation({
    onSuccess: async () => {
      setModelDraft(null);
      await utils.models.list.invalidate({ tenantId });
      void navigate(divisionPath("models", tenantId));
    },
  });

  // Seed the draft from the server the first time THIS model is opened. A draft already
  // held for it -- edits from an earlier visit -- is kept, which is the point of the store.
  const held = draft !== null && draft.tenantId === tenantId && draft.name === name ? draft : null;
  useEffect(() => {
    if (model.data === undefined || held !== null) {
      return;
    }
    setModelDraft(draftFrom(tenantId, model.data));
  }, [model.data, held, tenantId, setModelDraft]);

  if (model.isPending || tenant.isPending || (model.isSuccess && held === null)) {
    return <Skeleton rows={6} />;
  }
  if (model.isError || tenant.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("models.editorNotLoaded", { name })}
      </Errata>
    );
  }
  if (held === null) {
    return <Skeleton rows={6} />;
  }

  const isAdmin = tenant.data.role === "admin";
  const dirty = isDirty(held);
  const busy = save.isPending || build.isPending || remove.isPending;
  const columns = model.data.lastBuild?.columns ?? [];

  return (
    <div className="sheet">
      <div className="head head--division">{t("models.head")}</div>
      <div className="body stack">
        <p className="prose">
          <Link className="plate plate--small" to={divisionPath("models", tenantId)}>
            {t("models.backToList")}
          </Link>
        </p>
        <h1>{name}</h1>

        {isAdmin ? null : <p className="note">{t("models.readOnlyNote")}</p>}

        <Suspense fallback={<Skeleton rows={6} />}>
          <SqlEditor
            key={`${tenantId}/${name}`}
            value={held.sql}
            onChange={setModelSql}
            readOnly={!isAdmin}
            label={t("models.sqlLabel")}
          />
        </Suspense>

        {isAdmin ? (
          <div className="row">
            <button
              className="plate plate--primary"
              disabled={busy || !dirty}
              type="button"
              onClick={(): void => {
                save.mutate({
                  tenantId,
                  name,
                  sql: held.sql,
                  tests: testsFor(held),
                  create: false,
                });
              }}
            >
              {save.isPending ? t("models.saving") : t("models.save")}
            </button>
            <button
              className="plate"
              disabled={busy || dirty}
              title={dirty ? t("models.buildHint") : undefined}
              type="button"
              onClick={(): void => {
                build.mutate({ tenantId, name });
              }}
            >
              {build.isPending ? t("models.building") : t("models.build")}
            </button>
            {dirty ? (
              <span className="datum datum--quiet">{t("models.unsaved")}</span>
            ) : save.isSuccess ? (
              <span className="datum datum--quiet" role="status">
                {t("models.savedNote")}
              </span>
            ) : null}
          </div>
        ) : null}

        {save.isError ? (
          <Errata heading={t("models.notSaved")} live={true}>
            {save.error.message}
          </Errata>
        ) : null}
        {build.isError ? (
          <Errata heading={t("models.notBuilt")} live={true}>
            {build.error.message}
          </Errata>
        ) : null}
        {build.isSuccess ? (
          <BuildPanel tenantId={tenantId} result={build.data} locale={locale} />
        ) : null}
      </div>

      <div className="band-rule" />
      <div className="head">{t("models.testsHead")}</div>
      <div className="body stack">
        <p className="prose">{t("models.testsLead")}</p>
        <TestsForm draft={held} columns={columns} canEdit={isAdmin} />
      </div>

      <div className="band-rule" />
      <div className="head">{t("models.referenceHead")}</div>
      <div className="body stack">
        <Reference tenantId={tenantId} />
      </div>

      {isAdmin ? (
        <>
          <div className="band-rule" />
          <div className="head">{t("models.deleteHead")}</div>
          <div className="body stack">
            <p className="prose">{t("models.deleteLead", { name })}</p>
            <details className="tokenform">
              <summary className="plate">{t("models.deleteHead")}</summary>
              <div className="hinge stack">
                <button
                  className="plate plate--primary"
                  disabled={busy}
                  type="button"
                  onClick={(): void => {
                    remove.mutate({ tenantId, name });
                  }}
                >
                  {remove.isPending ? t("models.deleting") : t("models.deleteConfirm", { name })}
                </button>
                {remove.isError ? (
                  <Errata heading={t("models.notDeleted")} live={true}>
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

/** What the build did: its outcome, its steps, and the first rows of the table it made. */
function BuildPanel({
  tenantId,
  result,
  locale,
}: {
  tenantId: string;
  result: BuildResult;
  locale: "vi" | "en";
}): React.JSX.Element {
  const { t } = useTranslation();
  const journal = `${divisionPath("journal", tenantId)}/${result.runId}`;

  return (
    <div className="hinge stack">
      <span className="hinge__punch hinge__punch--a" aria-hidden="true" />
      <span className="hinge__punch hinge__punch--b" aria-hidden="true" />
      <span className="label">
        {result.ok ? t("models.buildOkHead") : t("models.buildFailedHead")}
      </span>
      {result.error === null ? null : (
        <Errata heading={t("models.buildFailedHead")}>{result.error}</Errata>
      )}
      {result.testsFailed > 0 ? (
        <p className="note">{t("models.testsFailed", { count: result.testsFailed })}</p>
      ) : null}
      {result.steps.length > 0 ? <StepsTable steps={result.steps} locale={locale} /> : null}
      {result.preview === null ? null : (
        <>
          <span className="label">{t("models.previewHead")}</span>
          {result.preview.rows.length === 0 ? (
            <p className="note">{t("models.previewEmpty")}</p>
          ) : (
            <ResultTable result={result.preview} locale={locale} />
          )}
        </>
      )}
      <div className="row">
        <Link className="plate plate--small" to={journal}>
          {t("models.openInJournal")}
        </Link>
      </div>
    </div>
  );
}

/** The tests per column, as the draft holds them; every change is a write to the store. */
function TestsForm({
  draft,
  columns,
  canEdit,
}: {
  draft: ModelDraft;
  columns: readonly string[];
  canEdit: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const setModelTest = useUiStore((state) => state.setModelTest);
  const addColumn = useUiStore((state) => state.addModelTestColumn);
  const removeColumn = useUiStore((state) => state.removeModelTestColumn);
  const columnField = useRef<HTMLInputElement>(null);
  const rows = Object.entries(draft.tests);

  return (
    <div className="stack stack--tight">
      {rows.length === 0 ? (
        <p className="note">{t("models.noTests")}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t("models.colColumn")}</th>
              {TEST_KINDS.map((kind) => (
                <th key={kind} scope="col">
                  {t(TEST_HEAD[kind])}
                </th>
              ))}
              <th scope="col">{canEdit ? t("models.removeColumn") : ""}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([column, kinds]) => (
              <tr key={column}>
                <td className="datum">{column}</td>
                {TEST_KINDS.map((kind) => (
                  <td key={kind}>
                    <label className="punch">
                      <input
                        checked={kinds.includes(kind)}
                        disabled={!canEdit}
                        type="checkbox"
                        onChange={(event): void => {
                          setModelTest(column, kind, event.currentTarget.checked);
                        }}
                      />
                      <span className="punch__box" />
                      <span className="datum datum--quiet">{t(TEST_HEAD[kind])}</span>
                    </label>
                  </td>
                ))}
                <td>
                  {canEdit ? (
                    <button
                      className="plate plate--small"
                      type="button"
                      onClick={(): void => {
                        removeColumn(column);
                      }}
                    >
                      {t("models.removeColumn")}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit ? (
        <form
          className="stack stack--tight"
          onSubmit={(event): void => {
            event.preventDefault();
            const field = columnField.current;
            const column = field?.value.trim() ?? "";
            if (field === null || !isModelName(column)) {
              field?.reportValidity();
              return;
            }
            addColumn(column);
            field.value = "";
          }}
        >
          <div className="field">
            <label className="label" htmlFor="model-test-column">
              {t("models.addColumnLabel")}
            </label>
            <input
              autoComplete="off"
              className="input"
              id="model-test-column"
              list="model-columns"
              maxLength={63}
              name="column"
              pattern="[a-z][a-z0-9_]*"
              ref={columnField}
              required={true}
              title={t("models.nameInvalid")}
              type="text"
            />
            <datalist id="model-columns">
              {columns.map((column) => (
                <option key={column} value={column} />
              ))}
            </datalist>
            <p className="field__hint">{t("models.addColumnHint")}</p>
          </div>
          <div className="row">
            <button className="plate" type="submit">
              {t("models.addColumn")}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** The platform's source and macros, disclosed on demand. Read-only by construction. */
function Reference({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const reference = trpc.models.reference.useQuery({ tenantId });

  return (
    <details className="tokenform">
      <summary className="plate">{t("models.referenceHead")}</summary>
      <div className="hinge stack">
        <p className="prose">{t("models.referenceLead")}</p>
        {reference.isPending ? <Skeleton rows={3} /> : null}
        {reference.isError ? (
          <Errata heading={t("common.notLoaded")}>{reference.error.message}</Errata>
        ) : null}
        {reference.isSuccess ? (
          <>
            <span className="label">{t("models.sourcesHead")}</span>
            <pre className="payload__text">{reference.data.sourcesYml}</pre>
            <span className="label">{t("models.macrosHead")}</span>
            {reference.data.macros.map((macro) => (
              <pre key={macro.name} className="payload__text">
                {macro.sql}
              </pre>
            ))}
          </>
        ) : null}
      </div>
    </details>
  );
}
