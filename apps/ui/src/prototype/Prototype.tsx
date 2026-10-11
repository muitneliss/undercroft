import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Book } from "@/components/Book.tsx";
import { useNavigation, useWords } from "@/features/models-workspace/hooks.ts";
import { ModelsWorkspace } from "@/features/models-workspace/ModelsWorkspace.tsx";
import type { ProfileSource } from "@/features/models-workspace/profileSource.ts";
import { createCatalog } from "./fixtures.ts";

const source: ProfileSource = {
  details: async (id, signal) => {
    signal.throwIfAborted();
    const data = await import("./details.ts");
    signal.throwIfAborted();
    return data.readDetails(id);
  },
  sample: async (id, signal) => {
    signal.throwIfAborted();
    const data = await import("./details.ts");
    signal.throwIfAborted();
    return data.readSample(id);
  },
};

const catalogs = { small: createCatalog(250), large: createCatalog(1000) };
export function Prototype(): React.JSX.Element {
  const { t } = useWords();
  const [params] = useSearchParams();
  const go = useNavigation();
  const location = useLocation();
  const inside = location.pathname === "/" || location.pathname.endsWith("/models");
  return (
    <Book current="models" tenantId="CASE-0042" signedInAs="operator@example.test">
      <div className="models-workspace">
        <div className="mw-prototype-banner">
          <strong>{t("modelsWorkspace.fixture")}</strong>
          <label>
            {t("modelsWorkspace.scale")}
            {t("modelsWorkspace.space")}
            <select
              className="input input--select"
              value={params.get("scale") ?? "250"}
              onChange={(event): void => go({ scale: event.target.value, page: null })}
            >
              <option value="250">{250}</option>
              <option value="1000">{1000}</option>
            </select>
          </label>
        </div>
        {inside ? (
          <ModelsWorkspace
            source={source}
            catalog={params.get("scale") === "1000" ? catalogs.large : catalogs.small}
          />
        ) : (
          <div className="models-workspace mw-empty">
            <p>{t("modelsWorkspace.syntheticOnly")}</p>
            <Link to="/tenants/CASE-0042/models">{t("modelsWorkspace.returnModels")}</Link>
          </div>
        )}
      </div>
    </Book>
  );
}
