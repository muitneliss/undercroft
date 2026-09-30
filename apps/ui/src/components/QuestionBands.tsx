/**
 * The bands one open question is set in: its title and verbs, its parameters, and the one
 * that deletes it. How it is defined is `QuestionDefinition.tsx`'s.
 *
 * Split out of `routes/Question.tsx`, which held the whole leaf in one function. The split
 * follows the rules on the page: each band is a separate decision with its own head, and the
 * route above composes them and owns the mutations they share -- `busy` means "one request is
 * in flight", and it has to mean that across every band or two of them race.
 *
 * A question is READ first, as a dashboard is: its title, its parameters and its answer. An
 * author turns to the workbench with Edit question (`?edit=1`, in the address so a reload
 * mid-edit lands back in it), where the name, the definition, Discard and Delete are; a new
 * question has nothing to read and opens there. Save sits with Edit in both, as it does on a
 * dashboard, because a draft changed and left unsaved is still visible from the reading page.
 *
 * Nothing here interpolates a parameter into SQL. `{{name}}` holes are collected from the
 * compiled text, filled from the URL, and bound by the server; a hole left empty refuses the
 * run before it is sent rather than running a query with a blank in it.
 */

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { CopyLink } from "@/components/CopyLink.tsx";
import { Errata } from "@/components/Errata.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { withPoint } from "@/lib/chartData.ts";
import { divisionPath } from "@/lib/divisions.ts";
import { withParam } from "@/lib/params.ts";
import { isQuestionDirty, type QuestionDraft } from "@/lib/questionDraft.ts";
import { dashboardBack } from "@/lib/reportLinks.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** The id a dashboard never saved stands under in the address; it has no name to read. */
const NEW = "new";

/** The parameters a run needs, as `paramsFromSearch` resolved them against the URL. */
export interface BoundParams {
  readonly params: Record<string, string>;
  readonly missing: readonly string[];
}

type Remove = ReturnType<typeof trpc.bi.questions.delete.useMutation>;
type Save = ReturnType<typeof trpc.bi.questions.save.useMutation>;

/**
 * The way back to the dashboard this question was opened from, on the values it had.
 *
 * Named by the dashboard's own name when it can be read -- a return from the dashboard has
 * it in the cache already -- and in general words otherwise, rather than waiting on it.
 */
function DashboardBackLink({ tenantId }: { tenantId: string }): React.JSX.Element | null {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const back = dashboardBack(search, divisionPath("reports", tenantId));
  const dashboard = trpc.bi.dashboards.get.useQuery(
    { tenantId, id: back?.id ?? "" },
    { enabled: back !== null && back.id !== NEW },
  );
  if (back === null) {
    return null;
  }
  return (
    <Link className="plate plate--small" to={back.href}>
      {dashboard.data === undefined
        ? t("bi.backToDashboard")
        : t("bi.backToNamedDashboard", { name: dashboard.data.name })}
    </Link>
  );
}

/** What the title band's verbs do; the route owns the address and the draft they change. */
export interface HeadActions {
  readonly save: Save;
  readonly busy: boolean;
  readonly onEdit: (on: boolean) => void;
  /** Drop the draft's changes: back to what is saved, or out of a question never saved. */
  readonly onDiscard: () => void;
}

/**
 * The question's title, the ways back, and the verbs: for an author, Edit or Done, Save and
 * (while editing) Discard; for every role, Copy link on a saved question.
 */
export function QuestionHead({
  tenantId,
  draft,
  canAuthor,
  edit,
  actions,
}: {
  tenantId: string;
  draft: QuestionDraft;
  canAuthor: boolean;
  edit: boolean;
  actions: HeadActions;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="body stack">
      <div className="row">
        <Link className="plate plate--small" to={divisionPath("reports", tenantId)}>
          {t("bi.backToReports")}
        </Link>
        <DashboardBackLink tenantId={tenantId} />
      </div>
      <h1>{draft.name === "" ? t("bi.untitled") : draft.name}</h1>

      {canAuthor ? (
        edit ? (
          <NameField name={draft.name} />
        ) : null
      ) : (
        <p className="note">{draft.id === null ? t("bi.viewerNew") : t("bi.viewerNote")}</p>
      )}
      {canAuthor ? (
        <QuestionVerbs tenantId={tenantId} draft={draft} edit={edit} actions={actions} />
      ) : null}
      {draft.id === null ? null : (
        <div className="row">
          <CopyLink />
        </div>
      )}
      {actions.save.isError ? (
        <Errata heading={t("bi.notSaved")} live={true} error={actions.save.error} />
      ) : null}
    </div>
  );
}

function NameField({ name }: { name: string }): React.JSX.Element {
  const { t } = useTranslation();
  const qNameId = useId();
  const setQuestionName = useUiStore((state) => state.setQuestionName);

  return (
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
        value={name}
        onChange={(event): void => {
          setQuestionName(event.currentTarget.value);
        }}
      />
    </div>
  );
}

/**
 * Edit or Done, Save, Discard, and what the draft's state says about each. Done is not
 * offered on a question never saved, which has no reading page to return to; Discard is,
 * and leaves it. An untitled question is saved as "untitled".
 */
function QuestionVerbs({
  tenantId,
  draft,
  edit,
  actions,
}: {
  tenantId: string;
  draft: QuestionDraft;
  edit: boolean;
  actions: HeadActions;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { save, busy, onEdit, onDiscard } = actions;
  const dirty = isQuestionDirty(draft);

  return (
    <div className="row">
      {draft.id === null ? null : (
        <button
          className="plate"
          type="button"
          onClick={(): void => {
            onEdit(!edit);
          }}
        >
          {edit ? t("bi.done") : t("bi.editQuestion")}
        </button>
      )}
      <button
        className="plate plate--primary"
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
      {edit ? (
        <button className="plate" disabled={busy || !dirty} type="button" onClick={onDiscard}>
          {t("bi.discard")}
        </button>
      ) : null}
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
            // A selected point names a row of the answer it was chosen on, not of the next one.
            let next = withPoint(search, null);
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
