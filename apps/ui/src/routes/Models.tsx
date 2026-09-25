/**
 * The models division: the customer's dbt models, listed with their last build, and the
 * form that starts a new one.
 *
 * A model is one SELECT over `raw.records`, built into a table in this customer's own
 * analytics schema by this customer's own database login. The list says what exists and
 * how the last build of each went, in the same four marks the grants use. A model whose
 * draft in the store differs from what was saved says so here too, because an author who
 * switched divisions mid-edit should not find their work silently gone -- or silently kept.
 *
 * Creating is admin-only, like saving: a model is what a dashboard will show. The name is
 * checked by the browser's own constraint validation before it is sent, so a bad name is a
 * message at the field and not a refusal from the server; the server refuses regardless.
 */

import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { StatusMark } from "@/components/StatusMark.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { buildMark, buildMarkLabel } from "@/lib/modelBuild.ts";
import { isDirty } from "@/lib/modelDraft.ts";
import { isModelName } from "@/lib/modelName.ts";
import { modelTemplate } from "@/lib/modelTemplate.ts";
import { relativeTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** The name rule as the browser enforces it at the field. The server enforces it again. */
const NAME_PATTERN = "[a-z][a-z0-9_]*";
const NAME_MAX = 63;

export function Models({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const draft = useUiStore((state) => state.modelDraft);
  const models = trpc.models.list.useQuery({ tenantId });
  const tenant = trpc.tenants.get.useQuery({ tenantId });

  if (models.isPending || tenant.isPending) {
    return <Skeleton rows={4} />;
  }
  if (models.isError || tenant.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("models.notLoaded", { tenantId })}
      </Errata>
    );
  }

  const isAdmin = tenant.data.role === "admin";
  const base = divisionPath("models", tenantId);
  // The one model whose draft is unsaved, if any: named on its row.
  const unsaved =
    draft !== null && draft.tenantId === tenantId && isDirty(draft) ? draft.name : null;

  return (
    <div className="sheet">
      <div className="head head--division">{t("models.head")}</div>
      <div className="body stack">
        <h1>{t("models.title")}</h1>
        <p className="prose prose--lead">{t("models.lead", { tenantId })}</p>

        {models.data.length === 0 ? (
          <EmptyState
            title={t("models.emptyTitle")}
            body={isAdmin ? t("models.emptyBody") : t("models.emptyBodyViewer")}
          />
        ) : (
          <table className="table">
            <caption>{t("models.caption", { count: models.data.length })}</caption>
            <thead>
              <tr>
                <th scope="col">{t("models.colName")}</th>
                <th scope="col">{t("models.colUpdated")}</th>
                <th scope="col">{t("models.colBuild")}</th>
              </tr>
            </thead>
            <tbody>
              {models.data.map((model) => (
                <tr key={model.name}>
                  <td>
                    <Link className="journal__what" to={`${base}/${model.name}`}>
                      {model.name}
                    </Link>
                    {unsaved === model.name ? (
                      <span className="datum datum--quiet journal__trigger">
                        {t("models.unsaved")}
                      </span>
                    ) : null}
                  </td>
                  <td className="datum datum--quiet">{relativeTime(model.updatedAt, locale)}</td>
                  <td>
                    <StatusMark
                      mark={buildMark(model.lastBuild?.status ?? null)}
                      label={buildMarkLabel(t, model.lastBuild?.status ?? null)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isAdmin ? (
        <>
          <div className="band-rule" />
          <div className="head">{t("models.newHead")}</div>
          <div className="body stack">
            <NewModelForm tenantId={tenantId} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function NewModelForm({ tenantId }: { tenantId: string }): React.JSX.Element {
  const modelNameId = useId();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const nameFieldRef = useRef<HTMLInputElement>(null);

  const create = trpc.models.save.useMutation({
    onSuccess: async (_result, variables) => {
      await utils.models.list.invalidate({ tenantId });
      void navigate(`${divisionPath("models", tenantId)}/${variables.name}`);
    },
  });

  return (
    <form
      className="stack stack--tight"
      onSubmit={(event): void => {
        event.preventDefault();
        const field = nameFieldRef.current;
        const name = field?.value.trim() ?? "";
        if (field === null || !isModelName(name)) {
          field?.reportValidity();
          return;
        }
        create.mutate({
          tenantId,
          name,
          sql: modelTemplate(name),
          tests: { columns: {} },
          create: true,
        });
      }}
    >
      <p className="prose">{t("models.newLead")}</p>
      <div className="field">
        <label className="label" htmlFor={modelNameId}>
          {t("models.nameLabel")}
        </label>
        <input
          autoComplete="off"
          className="input"
          disabled={create.isPending}
          id={modelNameId}
          maxLength={NAME_MAX}
          name="name"
          pattern={NAME_PATTERN}
          placeholder="stg_deals"
          ref={nameFieldRef}
          required={true}
          title={t("models.nameInvalid")}
          type="text"
        />
        <p className="field__hint">{t("models.nameHint")}</p>
      </div>
      {create.isError ? (
        <Errata heading={t("models.notCreated")} live={true} error={create.error} />
      ) : null}
      <div className="row">
        <button className="plate plate--primary" disabled={create.isPending} type="submit">
          {create.isPending ? t("models.creating") : t("models.create")}
        </button>
      </div>
    </form>
  );
}
