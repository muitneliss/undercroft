/**
 * The panels a model's leaf is made of below its editor: what a build did, the tests on each
 * column, and the platform's own source and macros.
 *
 * Split out of `routes/ModelEditor.tsx`, which held the leaf and all three. Each is a band on
 * that page with its own head, and none of them decides anything the route decides -- the
 * verbs, the draft and who may press them stay above.
 */

import { TEST_KINDS } from "@undercroft/contracts/models";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { BuildResult } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { ResultTable } from "@/components/ResultTable.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { StepsTable } from "@/components/StepsTable.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import type { ModelDraft } from "@/lib/modelDraft.ts";
import { isModelName } from "@/lib/modelName.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** Which catalogue key names each test kind's column in the tests table. */
const TEST_HEAD = { not_null: "models.colNotNull", unique: "models.colUnique" } as const;

/** What the build did: its outcome, its steps, and the first rows of the table it made. */
export function BuildPanel({
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
export function TestsForm({
  draft,
  columns,
  canEdit,
}: {
  draft: ModelDraft;
  columns: readonly string[];
  canEdit: boolean;
}): React.JSX.Element {
  const modelTestColumnId = useId();
  const modelColumnsId = useId();
  const { t } = useTranslation();
  const addColumn = useUiStore((state) => state.addModelTestColumn);
  const columnFieldRef = useRef<HTMLInputElement>(null);
  const rows = Object.entries(draft.tests);

  return (
    <div className="stack stack--tight">
      {rows.length === 0 ? (
        <p className="note">{t("models.noTests")}</p>
      ) : (
        <TestsTable rows={rows} canEdit={canEdit} />
      )}

      {canEdit ? (
        <form
          className="stack stack--tight"
          onSubmit={(event): void => {
            event.preventDefault();
            const field = columnFieldRef.current;
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
            <label className="label" htmlFor={modelTestColumnId}>
              {t("models.addColumnLabel")}
            </label>
            <input
              autoComplete="off"
              className="input"
              id={modelTestColumnId}
              list="model-columns"
              maxLength={63}
              name="column"
              pattern="[a-z][a-z0-9_]*"
              ref={columnFieldRef}
              required={true}
              title={t("models.nameInvalid")}
              type="text"
            />
            <datalist id={modelColumnsId}>
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
export function Reference({ tenantId }: { tenantId: string }): React.JSX.Element {
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

/** One row per column under test, one tick per kind. Every tick is a write to the store. */
function TestsTable({
  rows,
  canEdit,
}: {
  rows: readonly [string, readonly ("not_null" | "unique")[]][];
  canEdit: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const setModelTest = useUiStore((state) => state.setModelTest);
  const removeColumn = useUiStore((state) => state.removeModelTestColumn);

  return (
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
  );
}
