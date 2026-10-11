import "./details.css";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { patchWorkspace, useNavigation, useWords } from "./hooks.ts";
import { ModelLineage } from "./ModelLineage.tsx";
import { ModelList } from "./ModelList.tsx";
import { ModelProfile } from "./ModelProfile.tsx";
import type { ProfileSource } from "./profileSource.ts";
import type { Catalog } from "./types.ts";
import "./workspace.css";

export function ModelsWorkspace({
  catalog,
  source,
}: {
  catalog: Catalog;
  source: ProfileSource;
}): React.JSX.Element {
  const { t } = useWords();
  const [params] = useSearchParams();
  const go = useNavigation();
  const view = params.get("view") ?? "list";
  const id = params.get("model");
  useEffect(() => {
    patchWorkspace({
      quickModel: null,
      chooser: false,
      selected: [],
      layout: null,
      layoutStatus: "idle",
    });
  }, [id]);
  const model = catalog.models.find((item) => item.id === id);
  const profile = catalog.models.find((item) => item.id === (params.get("profile") ?? id));
  const isRoot = model || id === "raw.records" || id === "raw.documents";
  return (
    <div className="models-workspace mw-stack">
      <header className="mw-section-head">
        <div>
          <span className="mw-eyebrow">{t("models.head")}</span>
          <h1>{t("modelsWorkspace.title")}</h1>
        </div>
        <span>{t("modelsWorkspace.models", { count: catalog.models.length })}</span>
      </header>
      <nav className="mw-main-tabs" aria-label={t("models.viewsLabel")}>
        <button
          type="button"
          className="plate"
          aria-current={view === "lineage" ? undefined : "page"}
          onClick={(): void => go({ view: "list" })}
        >
          {t("modelsWorkspace.list")}
        </button>
        <button
          className="plate"
          type="button"
          aria-current={view === "lineage" ? "page" : undefined}
          onClick={(): void => go({ view: "lineage" })}
        >
          {t("modelsWorkspace.lineage")}
        </button>
      </nav>
      {id && !isRoot && <p className="mw-note">{t("modelsWorkspace.unavailableModel")}</p>}
      {view === "detail" && profile ? (
        <ModelProfile model={profile} catalog={catalog} source={source} />
      ) : view === "lineage" && id && isRoot ? (
        <ModelLineage root={id} catalog={catalog} />
      ) : (
        <ModelList catalog={catalog} picker={view !== "list"} />
      )}
    </div>
  );
}
