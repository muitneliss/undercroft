/**
 * One dashboard, open: saved questions on a twelve-column grid under shared filters.
 *
 * The draft lives in the store, seeded once per dashboard and kept, as the question draft
 * is. The filters' values live in the URL (`p.<name>`), so the dashboard with its filters
 * set is a link; whether the leaf is being edited lives there too (`?edit=1`), so a reload
 * mid-edit lands back in edit mode with the draft still held. Every tile reads its answer
 * through the query cache; nothing on this leaf runs a query itself.
 *
 * A member or an admin edits: the name, the filters, which questions are on, where, and in
 * what order they are read -- and, only while editing, deletes it. Discard puts the draft back
 * to what the server holds. A viewer
 * reads what was made for them; every role can copy the dashboard's link or print it.
 */

import { type DashboardFilter, IDENTIFIER } from "@undercroft/contracts/bi";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import type { DashboardView, QuestionView } from "@/api/types.ts";
import { DashboardHead, DeleteBand, TilesBand } from "@/components/DashboardBands.tsx";
import { FilterEditor } from "@/components/DashboardFilterEditor.tsx";
import { DashboardFilters } from "@/components/DashboardFilters.tsx";
import { Errata } from "@/components/Errata.tsx";
import { ReadingOrder } from "@/components/ReadingOrder.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import {
  type DashboardDraft,
  draftFromDashboard,
  newDashboardDraft,
} from "@/lib/dashboardDraft.ts";
import { divisionPath } from "@/lib/divisions.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

import "@/styles/reports.css";

const NEW = "new";
const EDIT = "edit";

/**
 * Seed the draft once per dashboard, and hand back the one held for it.
 *
 * A draft already held is kept: an author who leaves to open a question and comes back finds
 * the tiles where they left them.
 */
function useDashboardDraft(tenantId: string, id: string, isNew: boolean): DashboardDraft | null {
  const draft = useUiStore((state) => state.dashboardDraft);
  const setDashboardDraft = useUiStore((state) => state.setDashboardDraft);
  const dashboard = trpc.bi.dashboards.get.useQuery({ tenantId, id }, { enabled: !isNew });

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

  return held;
}

export function Dashboard({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const params = useParams();
  const id = params.id ?? NEW;
  const isNew = id === NEW;
  const locale = useUiStore((state) => state.locale);
  const setDashboardDraft = useUiStore((state) => state.setDashboardDraft);
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const tenant = trpc.tenants.get.useQuery({ tenantId });
  const questions = trpc.bi.questions.list.useQuery({ tenantId });
  const dashboard = trpc.bi.dashboards.get.useQuery({ tenantId, id }, { enabled: !isNew });
  const held = useDashboardDraft(tenantId, id, isNew);

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
      stored={dashboard.data ?? null}
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

/**
 * Turning between reading and editing, and Discard: the two verbs that move the leaf rather
 * than send anything. Edit mode is written to the address -- not the store, so a reload
 * mid-edit lands back in it. Discard re-seeds the draft from what the server holds, or -- for
 * a dashboard never saved -- drops it and leaves, there being nothing to return to.
 */
function useLeafTurns(
  tenantId: string,
  stored: DashboardView | null,
): { onEdit: (on: boolean) => void; onDiscard: () => void } {
  const [search, setSearch] = useSearchParams();
  const setDashboardDraft = useUiStore((state) => state.setDashboardDraft);
  const navigate = useNavigate();
  return {
    onEdit: (on): void => {
      const next = new URLSearchParams(search);
      if (on) {
        next.set(EDIT, "1");
      } else {
        next.delete(EDIT);
      }
      setSearch(next);
    },
    onDiscard: (): void => {
      if (stored === null) {
        setDashboardDraft(null);
        void navigate(divisionPath("reports", tenantId));
      } else {
        setDashboardDraft(draftFromDashboard(tenantId, stored));
      }
    },
  };
}

function DashboardLeaf({
  tenantId,
  draft,
  stored,
  questions,
  canAuthor,
  locale,
  onSaved,
  onDeleted,
}: {
  tenantId: string;
  draft: DashboardDraft;
  /** What the server holds, which Discard returns to; null for a dashboard never saved. */
  stored: DashboardView | null;
  questions: QuestionView[];
  canAuthor: boolean;
  locale: "vi" | "en";
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const markDashboardSaved = useUiStore((state) => state.markDashboardSaved);
  const turns = useLeafTurns(tenantId, stored);

  const save = trpc.bi.dashboards.save.useMutation({
    onSuccess: async (saved) => {
      markDashboardSaved(saved.id);
      await onSaved(saved.id);
    },
  });
  const remove = trpc.bi.dashboards.delete.useMutation({ onSuccess: onDeleted });

  const edit = canAuthor && search.get(EDIT) === "1";
  const valid = filtersValid(draft.filters);
  const busy = save.isPending || remove.isPending;

  return (
    <div className="sheet sheet--dashboard">
      <div className="head head--division">{t("reports.head")}</div>

      <DashboardHead
        tenantId={tenantId}
        draft={draft}
        canAuthor={canAuthor}
        edit={edit}
        valid={valid}
        busy={busy}
        save={save}
        onEdit={turns.onEdit}
        onDiscard={turns.onDiscard}
      />

      {edit ? (
        <>
          <div className="band-rule" />
          <div className="head">{t("dashboard.filtersEditHead")}</div>
          <FilterEditor filters={draft.filters} valid={valid} />
          <ReadingOrder layout={draft.layout} questions={questions} locale={locale} />
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

      <TilesBand
        tenantId={tenantId}
        draft={draft}
        questions={questions}
        canAuthor={canAuthor}
        locale={locale}
        edit={edit}
        search={search}
      />

      {/* Only while editing, as on the question page: a reader who came to read the figures
          is never one press from a fold that deletes them. */}
      {edit ? (
        <DeleteBand
          tenantId={tenantId}
          draft={draft}
          canAuthor={canAuthor}
          busy={busy}
          remove={remove}
        />
      ) : null}
    </div>
  );
}
