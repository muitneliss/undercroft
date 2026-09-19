/**
 * One dashboard, open: saved questions on a twelve-column grid under shared filters.
 *
 * The draft lives in the store, seeded once per dashboard and kept, as the question draft
 * is. The filters' values live in the URL (`p.<name>`), so the dashboard with its filters
 * set is a link; whether the leaf is being edited lives there too (`?edit=1`), so a reload
 * mid-edit lands back in edit mode with the draft still held. Every tile reads its answer
 * through the query cache; nothing on this leaf runs a query itself.
 *
 * A member or an admin edits: the name, the filters, which questions are on and where.
 * A viewer reads what was made for them.
 */

import { type DashboardFilter, IDENTIFIER } from "@undercroft/contracts/bi";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import type { QuestionView } from "@/api/types.ts";
import { DashboardFilters } from "@/components/DashboardFilters.tsx";
import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { QuestionCard } from "@/components/QuestionCard.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import {
  type DashboardDraft,
  draftFromDashboard,
  isDashboardDirty,
  newDashboardDraft,
} from "@/lib/dashboardDraft.ts";
import { addTile, applyTileAction, inReadingOrder } from "@/lib/dashboardLayout.ts";
import { divisionPath } from "@/lib/divisions.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const NEW = "new";
const EDIT = "edit";

export function Dashboard({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const params = useParams();
  const id = params.id ?? NEW;
  const isNew = id === NEW;
  const locale = useUiStore((state) => state.locale);
  const draft = useUiStore((state) => state.dashboardDraft);
  const setDashboardDraft = useUiStore((state) => state.setDashboardDraft);
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const tenant = trpc.tenants.get.useQuery({ tenantId });
  const questions = trpc.bi.questions.list.useQuery({ tenantId });
  const dashboard = trpc.bi.dashboards.get.useQuery({ tenantId, id }, { enabled: !isNew });

  // Seed once per dashboard; a draft already held for it is kept.
  const held =
    draft !== null && draft.tenantId === tenantId && (isNew ? draft.id === null : draft.id === id)
      ? draft
      : null;
  useEffect(() => {
    if (held !== null) {
      return;
    }
    if (isNew) {
      setDashboardDraft(newDashboardDraft(tenantId));
      return;
    }
    if (dashboard.data !== undefined) {
      setDashboardDraft(draftFromDashboard(tenantId, dashboard.data));
    }
  }, [held, isNew, dashboard.data, tenantId, setDashboardDraft]);

  if (tenant.isPending || questions.isPending || (!isNew && dashboard.isPending)) {
    return <Skeleton rows={6} />;
  }
  if (tenant.isError || questions.isError || dashboard.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("dashboard.notLoaded")}
      </Errata>
    );
  }
  if (held === null) {
    return <Skeleton rows={6} />;
  }

  return (
    <DashboardLeaf
      tenantId={tenantId}
      draft={held}
      questions={questions.data}
      canAuthor={tenant.data.role !== "viewer"}
      locale={locale}
      onSaved={async (savedId): Promise<void> => {
        await utils.bi.dashboards.list.invalidate({ tenantId });
        await utils.bi.dashboards.get.invalidate({ tenantId, id: savedId });
        if (isNew) {
          void navigate(`${divisionPath("reports", tenantId)}/dashboards/${savedId}`, {
            replace: true,
          });
        }
      }}
      onDeleted={async (): Promise<void> => {
        setDashboardDraft(null);
        await utils.bi.dashboards.list.invalidate({ tenantId });
        void navigate(divisionPath("reports", tenantId));
      }}
    />
  );
}

/** Whether every filter can be saved: a plain identifier, once, with a label. */
function filtersValid(filters: readonly DashboardFilter[]): boolean {
  const names = new Set(filters.map((filter) => filter.name));
  return (
    names.size === filters.length &&
    filters.every((filter) => IDENTIFIER.test(filter.name) && filter.label.trim() !== "")
  );
}

function DashboardLeaf({
  tenantId,
  draft,
  questions,
  canAuthor,
  locale,
  onSaved,
  onDeleted,
}: {
  tenantId: string;
  draft: DashboardDraft;
  questions: QuestionView[];
  canAuthor: boolean;
  locale: "vi" | "en";
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const setDashboardName = useUiStore((state) => state.setDashboardName);
  const setDashboardLayout = useUiStore((state) => state.setDashboardLayout);
  const setDashboardFilters = useUiStore((state) => state.setDashboardFilters);
  const markDashboardSaved = useUiStore((state) => state.markDashboardSaved);

  const save = trpc.bi.dashboards.save.useMutation({
    onSuccess: async (saved) => {
      markDashboardSaved(saved.id);
      await onSaved(saved.id);
    },
  });
  const remove = trpc.bi.dashboards.delete.useMutation({ onSuccess: onDeleted });

  const edit = canAuthor && search.get(EDIT) === "1";
  const dirty = isDashboardDirty(draft);
  const valid = filtersValid(draft.filters);
  const busy = save.isPending || remove.isPending;
  const base = divisionPath("reports", tenantId);
  const byId = new Map(questions.map((question) => [question.id, question]));
  const tiles = inReadingOrder(draft.layout);
  const onGrid = new Set(tiles.map((tile) => tile.questionId));
  const addable = questions.filter((question) => !onGrid.has(question.id));

  function setEdit(on: boolean): void {
    const next = new URLSearchParams(search);
    if (on) {
      next.set(EDIT, "1");
    } else {
      next.delete(EDIT);
    }
    setSearch(next);
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
        <h1>{draft.name === "" ? t("dashboard.untitled") : draft.name}</h1>

        {canAuthor ? (
          edit ? (
            <div className="field">
              <label className="label" htmlFor="d-name">
                {t("dashboard.nameLabel")}
              </label>
              <input
                autoComplete="off"
                className="input"
                id="d-name"
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
          <div className="row">
            <button
              className="plate"
              type="button"
              onClick={(): void => {
                setEdit(!edit);
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
        ) : null}
        {save.isError ? (
          <Errata heading={t("bi.notSaved")} live={true}>
            {save.error.message}
          </Errata>
        ) : null}
      </div>

      {edit ? (
        <>
          <div className="band-rule" />
          <div className="head">{t("dashboard.filtersEditHead")}</div>
          <div className="body stack">
            <p className="prose">
              {t("dashboard.filtersEditLead", {
                from: "{{period_from}}",
                to: "{{period_to}}",
                name: "{{stage}}",
              })}
            </p>
            {draft.filters.map((filter, i) => (
              <div key={String(i)} className="row builder__filter">
                <div className="field">
                  <label className="label" htmlFor={`d-filter-name-${String(i)}`}>
                    {t("dashboard.filterName")}
                  </label>
                  <input
                    autoComplete="off"
                    className="input"
                    id={`d-filter-name-${String(i)}`}
                    maxLength={63}
                    pattern="[A-Za-z_][A-Za-z0-9_]*"
                    title={t("dashboard.filterNameHint")}
                    type="text"
                    value={filter.name}
                    onChange={(event): void => {
                      const name = event.currentTarget.value;
                      setDashboardFilters(
                        draft.filters.map((held, j) => (j === i ? { ...held, name } : held)),
                      );
                    }}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor={`d-filter-kind-${String(i)}`}>
                    {t("dashboard.filterKind")}
                  </label>
                  <select
                    className="input input--select"
                    id={`d-filter-kind-${String(i)}`}
                    value={filter.kind}
                    onChange={(event): void => {
                      const chosen = event.currentTarget.value;
                      const kind = chosen === "date_range" || chosen === "number" ? chosen : "text";
                      setDashboardFilters(
                        draft.filters.map((held, j) => (j === i ? { ...held, kind } : held)),
                      );
                    }}
                  >
                    <option value="text">{t("dashboard.kindText")}</option>
                    <option value="number">{t("dashboard.kindNumber")}</option>
                    <option value="date_range">{t("dashboard.kindDateRange")}</option>
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor={`d-filter-label-${String(i)}`}>
                    {t("dashboard.filterLabel")}
                  </label>
                  <input
                    autoComplete="off"
                    className="input"
                    id={`d-filter-label-${String(i)}`}
                    maxLength={80}
                    type="text"
                    value={filter.label}
                    onChange={(event): void => {
                      const label = event.currentTarget.value;
                      setDashboardFilters(
                        draft.filters.map((held, j) => (j === i ? { ...held, label } : held)),
                      );
                    }}
                  />
                </div>
                <button
                  className="plate plate--small"
                  type="button"
                  onClick={(): void => {
                    setDashboardFilters(draft.filters.filter((_held, j) => j !== i));
                  }}
                >
                  {t("dashboard.removeFilter")}
                </button>
              </div>
            ))}
            <div className="row">
              <button
                className="plate"
                type="button"
                onClick={(): void => {
                  setDashboardFilters([...draft.filters, { name: "", kind: "text", label: "" }]);
                }}
              >
                {t("dashboard.addFilter")}
              </button>
              {valid ? null : (
                <span className="datum datum--quiet">{t("dashboard.filterNameHint")}</span>
              )}
            </div>
          </div>
        </>
      ) : null}

      {draft.filters.length > 0 && valid ? (
        <>
          <div className="band-rule" />
          <div className="head">{t("dashboard.filtersHead")}</div>
          <div className="body stack">
            <DashboardFilters filters={draft.filters} search={search} onApply={setSearch} />
          </div>
        </>
      ) : null}

      <div className="band-rule" />
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
          questions.length === 0 ? (
            <p className="note">{t("dashboard.noQuestionsYet")}</p>
          ) : addable.length === 0 ? (
            <p className="note">{t("dashboard.noneToAdd")}</p>
          ) : (
            <form
              className="row"
              onSubmit={(event): void => {
                event.preventDefault();
                const chosen = String(new FormData(event.currentTarget).get("question") ?? "");
                if (byId.has(chosen)) {
                  setDashboardLayout(addTile(draft.layout, chosen));
                }
              }}
            >
              <div className="field">
                <label className="label" htmlFor="d-add">
                  {t("dashboard.addQuestion")}
                </label>
                <select
                  className="input input--select"
                  id="d-add"
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
          )
        ) : null}
      </div>

      {canAuthor && draft.id !== null ? (
        <>
          <div className="band-rule" />
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
      ) : null}
    </div>
  );
}
