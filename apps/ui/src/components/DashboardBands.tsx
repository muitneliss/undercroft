/**
 * The bands one open dashboard is set in: its title and verbs, the filters as they are
 * defined, the tiles, and the one that deletes it.
 *
 * Split out of `routes/Dashboard.tsx`, which held the whole leaf in one function. Each band
 * has its own head on the page, and the route above keeps what they share: the draft, the two
 * mutations, and whether the leaf is being edited -- which lives in the URL rather than in
 * the store, so a reload mid-edit lands back in edit mode.
 */

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { QuestionView } from "@/api/types.ts";
import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { QuestionCard } from "@/components/QuestionCard.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import type { DashboardDraft } from "@/lib/dashboardDraft.ts";
import { isDashboardDirty } from "@/lib/dashboardDraft.ts";
import { addTile, applyTileAction, inReadingOrder } from "@/lib/dashboardLayout.ts";
import { divisionPath } from "@/lib/divisions.ts";
import { useUiStore } from "@/store.ts";
import type { trpc } from "@/trpc.ts";

type Save = ReturnType<typeof trpc.bi.dashboards.save.useMutation>;
type Remove = ReturnType<typeof trpc.bi.dashboards.delete.useMutation>;

/**
 * The title, the name field while editing, and the two verbs.
 *
 * Save is disabled while a filter is unnamed or named twice: the server would refuse it, and
 * a refusal after the press is a worse way to learn than a plate that will not go down.
 */
export function DashboardHead({
  tenantId,
  draft,
  canAuthor,
  edit,
  valid,
  busy,
  save,
  onEdit,
}: {
  tenantId: string;
  draft: DashboardDraft;
  canAuthor: boolean;
  edit: boolean;
  valid: boolean;
  busy: boolean;
  save: Save;
  onEdit: (on: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const dNameId = useId();
  const setDashboardName = useUiStore((state) => state.setDashboardName);
  const base = divisionPath("reports", tenantId);

  return (
    <div className="body stack">
      <p className="prose">
        <Link className="plate plate--small" to={base}>
          {t("bi.backToReports")}
        </Link>
      </p>
      <h1>{draft.name === "" ? t("dashboard.untitled") : draft.name}</h1>

      {canAuthor ? (
        edit ? (
          <div className="field">
            <label className="label" htmlFor={dNameId}>
              {t("dashboard.nameLabel")}
            </label>
            <input
              autoComplete="off"
              className="input"
              id={dNameId}
              maxLength={120}
              placeholder={t("dashboard.namePlaceholder")}
              type="text"
              value={draft.name}
              onChange={(event): void => {
                setDashboardName(event.currentTarget.value);
              }}
            />
          </div>
        ) : null
      ) : (
        <p className="note">
          {draft.id === null ? t("dashboard.viewerNew") : t("dashboard.viewerNote")}
        </p>
      )}

      {canAuthor ? (
        <DashboardVerbs
          tenantId={tenantId}
          draft={draft}
          edit={edit}
          valid={valid}
          busy={busy}
          save={save}
          onEdit={onEdit}
        />
      ) : null}
      {save.isError ? (
        <Errata heading={t("bi.notSaved")} live={true}>
          {save.error.message}
        </Errata>
      ) : null}
    </div>
  );
}

/**
 * Edit, Save, and what the draft's state says about each.
 *
 * Save is disabled while a filter is unnamed or named twice, because the server would refuse
 * it -- a refusal after the press is a worse way to learn than a plate that will not go down.
 */
function DashboardVerbs({
  tenantId,
  draft,
  edit,
  valid,
  busy,
  save,
  onEdit,
}: {
  tenantId: string;
  draft: DashboardDraft;
  edit: boolean;
  valid: boolean;
  busy: boolean;
  save: Save;
  onEdit: (on: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const dirty = isDashboardDirty(draft);

  return (
    <div className="row">
      <button
        className="plate"
        type="button"
        onClick={(): void => {
          onEdit(!edit);
        }}
      >
        {edit ? t("dashboard.done") : t("dashboard.edit")}
      </button>
      <button
        className="plate plate--primary"
        disabled={busy || !dirty || !valid}
        type="button"
        onClick={(): void => {
          save.mutate({
            tenantId,
            ...(draft.id === null ? {} : { id: draft.id }),
            name: draft.name === "" ? t("dashboard.untitled") : draft.name,
            layout: draft.layout,
            filters: draft.filters,
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
    </div>
  );
}

/** The grid itself, and -- while editing -- the one question that can be added to it. */
export function TilesBand({
  tenantId,
  draft,
  questions,
  canAuthor,
  locale,
  edit,
  search,
}: {
  tenantId: string;
  draft: DashboardDraft;
  questions: readonly QuestionView[];
  canAuthor: boolean;
  locale: "vi" | "en";
  edit: boolean;
  search: URLSearchParams;
}): React.JSX.Element {
  const { t } = useTranslation();
  const setDashboardLayout = useUiStore((state) => state.setDashboardLayout);
  const byId = new Map(questions.map((question) => [question.id, question]));
  const tiles = inReadingOrder(draft.layout);
  const onGrid = new Set(tiles.map((tile) => tile.questionId));
  const addable = questions.filter((question) => !onGrid.has(question.id));

  return (
    <>
      <Separator className="band-rule" />
      <div className="head">{t("dashboard.tilesHead")}</div>
      <div className="body stack">
        {tiles.length === 0 ? (
          <EmptyState
            title={t("dashboard.emptyTitle")}
            body={canAuthor ? t("dashboard.emptyBody") : t("dashboard.emptyBodyViewer")}
          />
        ) : (
          <div className="grid">
            {tiles.map((tile) => (
              <QuestionCard
                key={tile.questionId}
                tenantId={tenantId}
                tile={tile}
                question={byId.get(tile.questionId) ?? null}
                search={search}
                locale={locale}
                edit={edit}
                onAction={(action): void => {
                  setDashboardLayout(applyTileAction(draft.layout, tile.questionId, action));
                }}
              />
            ))}
          </div>
        )}

        {edit ? (
          <AddTileForm
            questions={questions}
            addable={addable}
            onAdd={(chosen): void => {
              setDashboardLayout(addTile(draft.layout, chosen));
            }}
          />
        ) : null}
      </div>
    </>
  );
}

/** Deleting a saved dashboard, behind a disclosure so it is not one press away. */
export function DeleteBand({
  tenantId,
  draft,
  canAuthor,
  busy,
  remove,
}: {
  tenantId: string;
  draft: DashboardDraft;
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
      <div className="head">{t("dashboard.deleteHead")}</div>
      <div className="body stack">
        <p className="prose">{t("dashboard.deleteLead", { name: draft.name })}</p>
        <details className="tokenform">
          <summary className="plate">{t("dashboard.deleteHead")}</summary>
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
              {remove.isPending ? t("bi.deleting") : t("dashboard.deleteConfirm")}
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
  );
}

/**
 * The one question a tile can be added from, while editing.
 *
 * Only questions not already on the grid are offered: a dashboard cannot hold the same
 * question twice, and offering one that would be refused is a press that goes nowhere. The
 * select is keyed by its options, so adding one re-renders rather than leaving the entry
 * that was just removed still selected.
 */
function AddTileForm({
  questions,
  addable,
  onAdd,
}: {
  questions: readonly QuestionView[];
  addable: readonly QuestionView[];
  onAdd: (questionId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const dAddId = useId();

  if (questions.length === 0) {
    return <p className="note">{t("dashboard.noQuestionsYet")}</p>;
  }
  if (addable.length === 0) {
    return <p className="note">{t("dashboard.noneToAdd")}</p>;
  }

  return (
    <form
      className="row row--field"
      onSubmit={(event): void => {
        event.preventDefault();
        const chosen = String(new FormData(event.currentTarget).get("question") ?? "");
        if (addable.some((question) => question.id === chosen)) {
          onAdd(chosen);
        }
      }}
    >
      <div className="field">
        <label className="label" htmlFor={dAddId}>
          {t("dashboard.addQuestion")}
        </label>
        <select
          className="input input--select"
          id={dAddId}
          key={addable.map((question) => question.id).join(",")}
          name="question"
        >
          {addable.map((question) => (
            <option key={question.id} value={question.id}>
              {question.name}
            </option>
          ))}
        </select>
      </div>
      <button className="plate" type="submit">
        {t("dashboard.add")}
      </button>
    </form>
  );
}
