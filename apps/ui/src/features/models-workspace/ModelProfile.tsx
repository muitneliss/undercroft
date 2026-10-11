import { ProfileDetails } from "./ProfileDetails.tsx";
import type { ProfileSource } from "./profileSource.ts";
import "./workspace.css";
import "./details.css";
import { useSearchParams } from "react-router-dom";
import { patchWorkspace, useNavigation, useWords } from "./hooks.ts";
import { GroupLabel } from "./shared.tsx";
import type { Catalog, ModelRecord } from "./types.ts";

export function ModelProfile({
  catalog,
  model,
  source,
}: {
  catalog: Catalog;
  model: ModelRecord;
  source: ProfileSource;
}): React.JSX.Element {
  const { t, locale } = useWords();
  const [params] = useSearchParams();
  const go = useNavigation();
  const tab = params.get("tab") ?? "overview";
  return (
    <section className="mw-stack">
      <button
        className="mw-link mw-back"
        type="button"
        onClick={(): void =>
          go(
            params.get("from") === "lineage"
              ? { view: "lineage", profile: null, from: null, tab: null }
              : { view: "list", model: null, profile: null, tab: null },
          )
        }
      >
        {t(
          params.get("from") === "lineage" ? "modelsWorkspace.backLineage" : "modelsWorkspace.back",
        )}
      </button>
      <div className="mw-section-head">
        <div>
          <span className="mw-eyebrow">
            <GroupLabel id={model.layer} />
          </span>
          <h2>{model.title[locale]}</h2>
          <code>{model.id}</code>
        </div>
        <button
          type="button"
          className="plate"
          onClick={(): void =>
            go({
              view: "lineage",
              model: model.id,
              profile: null,
              from: null,
              tab: null,
              mode: null,
            })
          }
        >
          {t("modelsWorkspace.flow")}
        </button>
      </div>
      <nav className="mw-tabs" aria-label={t("modelsWorkspace.understand")}>
        {(["overview", "data", "sql", "operations"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-current={tab === value ? "page" : undefined}
            onClick={(): void => go({ tab: value })}
          >
            {t(`modelsWorkspace.${value}`)}
          </button>
        ))}
      </nav>
      {tab === "overview" && <Overview model={model} catalog={catalog} source={source} />}
      {tab !== "overview" && <ProfileDetails model={model} source={source} tab={tab} />}
      <p className="mw-caption">{t("modelsWorkspace.provenance")}</p>
    </section>
  );
}
function Overview({
  model,
  catalog,
  source,
}: {
  model: ModelRecord;
  catalog: Catalog;
  source: ProfileSource;
}): React.JSX.Element {
  const { t, locale } = useWords();
  const go = useNavigation();
  return (
    <div className="mw-profile-grid">
      <div className="mw-stack">
        <section>
          <h3>{t("modelsWorkspace.purpose")}</h3>
          <p className="mw-lead">{model.description[locale]}</p>
        </section>
        <section>
          <h3>{t("modelsWorkspace.grain")}</h3>
          <p className="mw-lead">{model.grain?.[locale] ?? t("modelsWorkspace.missing")}</p>
        </section>
        <ProfileDetails model={model} source={source} tab="overview" />
        <dl className="mw-facts">
          <dt>{t("modelsWorkspace.status")}</dt>
          <dd>{t(`modelsWorkspace.${model.status}`)}</dd>
        </dl>
      </div>
      <aside className="mw-card mw-stack">
        <RelationSummary catalog={catalog} model={model} direction="up" />
        <RelationSummary catalog={catalog} model={model} direction="down" />
        <button
          type="button"
          className="plate"
          onClick={(): void => {
            patchWorkspace({ visible: [], expanded: [] });
            go({
              view: "lineage",
              model: model.id,
              profile: null,
              from: null,
              shown: null,
              expanded: null,
              selection: null,
              mode: "table",
              dir: "down",
              depth: "all",
              tab: null,
            });
          }}
        >
          {t("modelsWorkspace.impact")}
        </button>
      </aside>
    </div>
  );
}
function RelationSummary({
  catalog,
  model,
  direction,
}: {
  catalog: Catalog;
  model: ModelRecord;
  direction: "up" | "down";
}): React.JSX.Element {
  const { t, locale } = useWords();
  const go = useNavigation();
  const ids = catalog.edges
    .filter((edge) => (direction === "up" ? edge.target : edge.source) === model.id)
    .map((edge) => (direction === "up" ? edge.source : edge.target));
  return (
    <section>
      <h3>{direction === "up" ? t("modelsWorkspace.inputs") : t("modelsWorkspace.usedBy")}</h3>
      {ids.slice(0, 3).map((id) => (
        <p key={id}>
          <button
            className="mw-link"
            type="button"
            onClick={(): void => go({ view: "lineage", model: id, tab: null })}
          >
            {catalog.models.find((item) => item.id === id)?.title[locale] ?? id}
          </button>
        </p>
      ))}
      <small>{t("modelsWorkspace.models", { count: ids.length })}</small>
    </section>
  );
}
