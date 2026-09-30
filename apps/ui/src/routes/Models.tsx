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
 * Above the list, one count per last-build state, and pressing one narrows the list to it with
 * the state in the address (`modelBuild.ts`); beneath them, the list searched by name and put in
 * order, both in the address too (`modelList.ts`). Each row names the run that last built it,
 * so a failed build is one press from its steps. The division's second view is its lineage
 * (`ModelLineage`, ADR 0092), in the same address with `?view=lineage`: a view of Models and
 * not an eighth division, because the wheel is full (ADR 0019).
 *
 * Creating is admin-only, like saving: a model is what a dashboard will show. The name is
 * checked by the browser's own constraint validation before it is sent, so a bad name is a
 * message at the field and not a refusal from the server; the server refuses regardless.
 */

import type { TFunction } from "i18next";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { ModelLineage } from "@/components/ModelLineage.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { StatusMark } from "@/components/StatusMark.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { LINEAGE_VIEW, lineagePath, VIEW_PARAM } from "@/lib/lineage.ts";
import {
  BUILD_STATES,
  type BuildState,
  buildMark,
  buildMarkLabel,
  buildTally,
  builtColumnCount,
  stateLabel,
  stateMark,
} from "@/lib/modelBuild.ts";
import { isDirty } from "@/lib/modelDraft.ts";
import {
  isNarrowed,
  MODEL_SORTS,
  type ModelListFilters,
  modelListFilters,
  narrowModels,
  withFilters,
} from "@/lib/modelList.ts";
import { isModelName } from "@/lib/modelName.ts";
import { modelTemplate } from "@/lib/modelTemplate.ts";
import { formatCount, MISSING } from "@/lib/money.ts";
import { journalPath } from "@/lib/runs.ts";
import { relativeTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** The name rule as the browser enforces it at the field. The server enforces it again. */
const NAME_PATTERN = "[a-z][a-z0-9_]*";
const NAME_MAX = 63;

export function Models({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const tenant = trpc.tenants.get.useQuery({ tenantId });
  const lineage = params.get(VIEW_PARAM) === LINEAGE_VIEW;

  if (tenant.isPending) {
    return <Skeleton rows={4} />;
  }
  if (tenant.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("models.notLoaded", { tenantId })}
      </Errata>
    );
  }

  const isAdmin = tenant.data.role === "admin";
  const base = divisionPath("models", tenantId);

  return (
    <div className="sheet">
      <div className="head head--division">{t("models.head")}</div>
      <div className="body stack">
        <h1>{t("models.title")}</h1>
        <p className="prose prose--lead">{t("models.lead", { tenantId })}</p>
        {/* Two views of one division, not two divisions (ADR 0019): the wheel is full. */}
        <nav aria-label={t("models.viewsLabel")} className="langset">
          <Link
            className="plate plate--small"
            to={base}
            {...(lineage ? {} : { "aria-current": "page" as const })}
          >
            {t("models.viewList")}
          </Link>
          <Link
            className="plate plate--small"
            to={lineagePath(tenantId)}
            {...(lineage ? { "aria-current": "page" as const } : {})}
          >
            {t("models.viewLineage")}
          </Link>
        </nav>
        {lineage ? (
          <ModelLineage tenantId={tenantId} />
        ) : (
          <ModelList isAdmin={isAdmin} tenantId={tenantId} />
        )}
      </div>

      {isAdmin && !lineage ? (
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

/**
 * One count per last-build state above the list, and the list narrowed to the state the
 * address names. The counts are over every model the search matches, so they add up to the
 * models listed when no state is pressed -- and the line beneath them says so in figures, so a
 * reader can check it rather than take it. Pressing the count already pressed widens the list
 * again; a press keeps the search and the order (`modelList.ts`).
 */
function BuildTally({
  statuses,
  filters,
}: {
  statuses: readonly (string | null)[];
  filters: ModelListFilters;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const locale = useUiStore((state) => state.locale);
  const tally = buildTally(statuses);
  const filter = filters.build;
  function to(state: BuildState | null): string {
    const search = withFilters(params, { build: state }).toString();
    return search === "" ? "" : `?${search}`;
  }

  return (
    <>
      <nav aria-label={t("models.tallyLabel")} className="tally">
        {BUILD_STATES.map((state) => (
          <Link
            className="tally__count"
            key={state}
            to={{ search: to(filter === state ? null : state) }}
            {...(filter === state ? { "aria-current": "true" as const } : {})}
          >
            <span className="tally__figure">{formatCount(tally[state], locale)}</span>
            <StatusMark label={stateLabel(t, state)} mark={stateMark(state)} />
          </Link>
        ))}
        <Link
          className="tally__count"
          to={{ search: to(null) }}
          {...(filter === null ? { "aria-current": "true" as const } : {})}
        >
          <span className="tally__figure">{formatCount(statuses.length, locale)}</span>
          <span className="label">{t("models.tallyAll")}</span>
        </Link>
      </nav>
      <p className="datum datum--quiet">
        {t("models.tallySum", {
          parts: BUILD_STATES.map((state) => formatCount(tally[state], locale)).join(" + "),
          count: statuses.length,
        })}
      </p>
    </>
  );
}

/**
 * The search by name and the order, both written to the address as they change, and -- while
 * anything narrows the list -- one clear. Replaced rather than pushed: a keystroke is not a
 * page, and Back should leave the list, not unpick the search a letter at a time.
 */
function ListFilters({ filters }: { filters: ModelListFilters }): React.JSX.Element {
  const { t } = useTranslation();
  const searchId = useId();
  const sortId = useId();
  const [, setParams] = useSearchParams();

  function write(change: Parameters<typeof withFilters>[1]): void {
    setParams((current) => withFilters(current, change), { replace: true });
  }

  return (
    <div className="row row--field">
      <div className="field">
        <label className="label" htmlFor={searchId}>
          {t("models.searchLabel")}
        </label>
        <input
          autoComplete="off"
          className="input"
          id={searchId}
          placeholder="stg_deals"
          type="search"
          value={filters.query}
          onChange={(event): void => {
            write({ query: event.currentTarget.value });
          }}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor={sortId}>
          {t("models.sortLabel")}
        </label>
        <select
          className="input input--select"
          id={sortId}
          value={filters.sort}
          onChange={(event): void => {
            const sort = MODEL_SORTS.find((known) => known === event.currentTarget.value);
            write({ sort: sort ?? "attention" });
          }}
        >
          <option value="attention">{t("models.sortAttention")}</option>
          <option value="name">{t("models.sortName")}</option>
        </select>
      </div>
      {isNarrowed(filters) ? (
        <button
          className="plate"
          type="button"
          onClick={(): void => {
            write({ query: "", build: null, sort: "attention" });
          }}
        >
          {t("models.clearFilters")}
        </button>
      ) : null}
    </div>
  );
}

/** The caption: how many models, and -- when the list is narrowed -- how many of them show. */
function caption(
  t: TFunction,
  filters: ModelListFilters,
  counts: { total: number; shown: number },
): string {
  if (filters.build !== null) {
    return t("models.captionFiltered", {
      count: counts.total,
      shown: counts.shown,
      state: stateLabel(t, filters.build),
    });
  }
  return filters.query.trim() === ""
    ? t("models.caption", { count: counts.total })
    : t("models.captionMatched", { count: counts.total, shown: counts.shown });
}

function ModelList({
  tenantId,
  isAdmin,
}: {
  tenantId: string;
  isAdmin: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const locale = useUiStore((state) => state.locale);
  const draft = useUiStore((state) => state.modelDraft);
  const models = trpc.models.list.useQuery({ tenantId });

  if (models.isPending) {
    return <Skeleton rows={4} />;
  }
  if (models.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("models.notLoaded", { tenantId })}
      </Errata>
    );
  }
  if (models.data.length === 0) {
    return (
      <EmptyState
        title={t("models.emptyTitle")}
        body={isAdmin ? t("models.emptyBody") : t("models.emptyBodyViewer")}
      />
    );
  }

  const base = divisionPath("models", tenantId);
  const filters = modelListFilters(params);
  const { matched, shown } = narrowModels(models.data, filters);
  const statuses = matched.map((model) => model.lastBuild?.status ?? null);
  // The one model whose draft is unsaved, if any: named on its row.
  const unsaved =
    draft !== null && draft.tenantId === tenantId && isDirty(draft) ? draft.name : null;

  return (
    <>
      <BuildTally filters={filters} statuses={statuses} />
      <ListFilters filters={filters} />
      <table className="table">
        <caption>{caption(t, filters, { total: models.data.length, shown: shown.length })}</caption>
        <thead>
          <tr>
            <th scope="col">{t("models.colName")}</th>
            <th scope="col">{t("models.colBuild")}</th>
            <th scope="col">{t("models.colRun")}</th>
            <th className="num" scope="col">
              {t("models.colColumns")}
            </th>
            <th scope="col">{t("models.colUpdated")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((model) => {
            const columns = builtColumnCount(model.lastBuild);
            return (
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
                <td>
                  <StatusMark
                    mark={buildMark(model.lastBuild?.status ?? null)}
                    label={buildMarkLabel(t, model.lastBuild?.status ?? null)}
                  />
                </td>
                <td className="datum">
                  {model.lastBuild === null ? (
                    <span className="missing">{MISSING}</span>
                  ) : (
                    <Link to={journalPath(tenantId, { runId: model.lastBuild.runId })}>
                      {model.lastBuild.runId}
                    </Link>
                  )}
                </td>
                <td className="datum num">
                  {columns === null ? (
                    <span className="missing">{MISSING}</span>
                  ) : (
                    formatCount(columns, locale)
                  )}
                </td>
                <td className="datum datum--quiet">{relativeTime(model.updatedAt, locale)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
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
