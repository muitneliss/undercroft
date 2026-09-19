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

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/complexity/noVoid: `void` here marks a promise deliberately not awaited, at the two places where that is correct and where dropping the marker would make it look like an oversight.
// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/correctness/useUniqueElementIds: A static id on a single-instance form: the band renders once per Models leaf, and the id is what its <label> points at.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/nursery/useReactNamingConvention: Fires on the `nameField` handle, which it wants suffixed `Ref`. It is named for what it holds -- the name field -- which is how the form reads, and the convention this follows is DisplayNameForm's beside it.
// biome-ignore-all lint/performance/noJsxPropsBind: An inline submit handler on one form. The re-render the rule is about matters under a memoised list of hundreds; this is one <form>.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the route this file is named for first, then the parts of it that exist to keep that function readable. That ordering carries meaning; the rule's preferred one does not.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { useRef } from "react";
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const nameField = useRef<HTMLInputElement>(null);

  const create = trpc.models.save.useMutation({
    onSuccess: async (_result, variables) => {
      await utils.models.list.invalidate({ tenantId });
      void navigate(`${divisionPath("models", tenantId)}/${variables.name}`);
    },
  });

  return (
    <form
      className="stack stack--tight"
      onSubmit={(event) => {
        event.preventDefault();
        const field = nameField.current;
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
        <label className="label" htmlFor="model-name">
          {t("models.nameLabel")}
        </label>
        <input
          autoComplete="off"
          className="input"
          disabled={create.isPending}
          id="model-name"
          maxLength={NAME_MAX}
          name="name"
          pattern={NAME_PATTERN}
          placeholder="stg_deals"
          ref={nameField}
          required={true}
          title={t("models.nameInvalid")}
          type="text"
        />
        <p className="field__hint">{t("models.nameHint")}</p>
      </div>
      {create.isError ? (
        <Errata heading={t("models.notCreated")} live={true}>
          {create.error.message}
        </Errata>
      ) : null}
      <div className="row">
        <button className="plate plate--primary" disabled={create.isPending} type="submit">
          {create.isPending ? t("models.creating") : t("models.create")}
        </button>
      </div>
    </form>
  );
}
