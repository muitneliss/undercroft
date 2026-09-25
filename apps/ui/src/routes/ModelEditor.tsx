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

import { Suspense, lazy, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import type { ModelDetail } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { BuildPanel, Reference, TestsForm } from "@/components/ModelPanels.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { draftFrom, isDirty, type ModelDraft, testsFor } from "@/lib/modelDraft.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const SqlEditor = lazy(() =>
  import("@/components/SqlEditor.tsx").then((module) => ({ default: module.SqlEditor })),
);

type Save = ReturnType<typeof trpc.models.save.useMutation>;
type Build = ReturnType<typeof trpc.models.build.useMutation>;
type Remove = ReturnType<typeof trpc.models.delete.useMutation>;

/** Save and Build, plus whether any request is in flight; one press at a time, page-wide. */
interface ModelActions {
  readonly save: Save;
  readonly build: Build;
  readonly busy: boolean;
}

/**
 * Seed the draft from the server the first time THIS model is opened.
 *
 * A draft already held for it -- edits from an earlier visit -- is kept, which is the point
 * of the store: an author who leaves to read a failed build comes back to their own text.
 */
function useModelDraft(
  tenantId: string,
  name: string,
  stored: ModelDetail | undefined,
): ModelDraft | null {
  const draft = useUiStore((state) => state.modelDraft);
  const setModelDraft = useUiStore((state) => state.setModelDraft);
  const held = draft !== null && draft.tenantId === tenantId && draft.name === name ? draft : null;

  useEffect(() => {
    if (stored === undefined || held !== null) {
      return;
    }
    setModelDraft(draftFrom(tenantId, stored));
  }, [stored, held, tenantId, setModelDraft]);

  return held;
}

/**
 * The three verbs, wired to what each invalidates.
 *
 * Together because "one request at a time" is a page-wide fact: the list is about to be
 * re-read, and a second press answers about a model that no longer looks like this one.
 */
function useModelActions(
  tenantId: string,
  name: string,
): ModelActions & { readonly remove: Remove } {
  const setModelDraft = useUiStore((state) => state.setModelDraft);
  const markModelSaved = useUiStore((state) => state.markModelSaved);
  const navigate = useNavigate();
  const utils = trpc.useUtils();

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

  return {
    save,
    build,
    remove,
    busy: save.isPending || build.isPending || remove.isPending,
  };
}

export function ModelEditor({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const params = useParams();
  const name = params.name ?? "";
  const locale = useUiStore((state) => state.locale);

  const model = trpc.models.get.useQuery({ tenantId, name }, { enabled: name !== "" });
  const tenant = trpc.tenants.get.useQuery({ tenantId });
  const held = useModelDraft(tenantId, name, model.data);
  const { save, build, remove, busy } = useModelActions(tenantId, name);

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

  return (
    <div className="sheet">
      <div className="head head--division">{t("models.head")}</div>

      <EditorBand
        tenantId={tenantId}
        name={name}
        draft={held}
        isAdmin={isAdmin}
        locale={locale}
        actions={{ save, build, busy }}
      />

      <div className="band-rule" />
      <div className="head">{t("models.testsHead")}</div>
      <div className="body stack">
        <p className="prose">{t("models.testsLead")}</p>
        <TestsForm draft={held} columns={model.data.lastBuild?.columns ?? []} canEdit={isAdmin} />
      </div>

      <div className="band-rule" />
      <div className="head">{t("models.referenceHead")}</div>
      <div className="body stack">
        <Reference tenantId={tenantId} />
      </div>

      <DeleteBand tenantId={tenantId} name={name} isAdmin={isAdmin} busy={busy} remove={remove} />
    </div>
  );
}

/**
 * The SQL, the two verbs, and what they answered.
 *
 * Save stores what is on screen and executes nothing; Build runs dbt for this model alone,
 * from the SAVED version -- which is why it is disabled while the draft is dirty and says so
 * rather than quietly building something else.
 */
function EditorBand({
  tenantId,
  name,
  draft,
  isAdmin,
  locale,
  actions,
}: {
  tenantId: string;
  name: string;
  draft: ModelDraft;
  isAdmin: boolean;
  locale: "vi" | "en";
  actions: ModelActions;
}): React.JSX.Element {
  const { t } = useTranslation();
  const setModelSql = useUiStore((state) => state.setModelSql);
  const { save, build } = actions;

  return (
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
          value={draft.sql}
          onChange={setModelSql}
          readOnly={!isAdmin}
          label={t("models.sqlLabel")}
        />
      </Suspense>

      {isAdmin ? (
        <ModelVerbs tenantId={tenantId} name={name} draft={draft} actions={actions} />
      ) : null}

      {save.isError ? (
        <Errata heading={t("models.notSaved")} live={true} error={save.error} />
      ) : null}
      {build.isError ? (
        <Errata heading={t("models.notBuilt")} live={true} error={build.error} />
      ) : null}
      {build.isSuccess ? (
        <BuildPanel tenantId={tenantId} result={build.data} locale={locale} />
      ) : null}
    </div>
  );
}

/**
 * Deleting the model, behind a disclosure.
 *
 * The row goes; the built table stays until the next build, and the lead says so -- a delete
 * that silently left a stale table in `analytics` would be a dashboard reading a model
 * nobody can find.
 */
function DeleteBand({
  tenantId,
  name,
  isAdmin,
  busy,
  remove,
}: {
  tenantId: string;
  name: string;
  isAdmin: boolean;
  busy: boolean;
  remove: Remove;
}): React.JSX.Element | null {
  const { t } = useTranslation();

  if (!isAdmin) {
    return null;
  }

  return (
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
              <Errata heading={t("models.notDeleted")} live={true} error={remove.error} />
            ) : null}
          </div>
        </details>
      </div>
    </>
  );
}

/**
 * Save and Build, and what the state of the draft says about each.
 *
 * Build is disabled while the draft is dirty and says why in its title, because it runs the
 * SAVED version: a Build that quietly ran last night's SQL under this morning's text is a
 * result nobody could reproduce.
 */
function ModelVerbs({
  tenantId,
  name,
  draft,
  actions,
}: {
  tenantId: string;
  name: string;
  draft: ModelDraft;
  actions: ModelActions;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { save, build, busy } = actions;
  const dirty = isDirty(draft);

  return (
    <div className="row">
      <button
        className="plate plate--primary"
        disabled={busy || !dirty}
        type="button"
        onClick={(): void => {
          save.mutate({ tenantId, name, sql: draft.sql, tests: testsFor(draft), create: false });
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
  );
}
