import "./workspace.css";
import { useSearchParams } from "react-router-dom";
import { GRAPH_LIMIT, related } from "./catalog.ts";
import { patchWorkspace, useNavigation, useWords } from "./hooks.ts";
import { scopeFacts } from "./scope.ts";
import type { Catalog } from "./types.ts";
export function Expand({ catalog, id }: { catalog: Catalog; id: string }): React.JSX.Element {
  const { t } = useWords();
  const [params] = useSearchParams();
  const go = useNavigation();
  const root = params.get("model") ?? id;
  const facts = scopeFacts(catalog, root, params);
  const next = [...related(catalog, id, facts.direction, 1).keys()].filter(
    (value) => !facts.ids.includes(value),
  );
  function expand(): void {
    const expanded: string[] = [...new Set([...(params.get("expanded")?.split(",") ?? []), id])];
    const chosen: string[] = [...new Set([...facts.visible, ...next])];
    const over = chosen.length > GRAPH_LIMIT;
    patchWorkspace({
      undo: { query: params.toString() },
      chooser: over,
      selected: facts.visible.filter((value) => value !== root),
      chooserQuery: "",
      chooserPage: 1,
      selectedOnly: false,
    });
    go({
      expanded: expanded.join(","),
      shown: over ? facts.visible.join(",") : chosen.join(","),
      selection: null,
    });
  }
  const isExpanded = params.get("expanded")?.split(",").includes(id);
  if (isExpanded) {
    return (
      <button
        className="mw-link"
        type="button"
        onClick={(): void => {
          patchWorkspace({ undo: { query: params.toString() } });
          const branches =
            params
              .get("expanded")
              ?.split(",")
              .filter((value) => value !== id) ?? [];
          go({ expanded: branches.length > 0 ? branches.join(",") : null });
        }}
      >
        {t("modelsWorkspace.collapseBranch")}
      </button>
    );
  }
  return (
    <button className="mw-link" type="button" disabled={next.length === 0} onClick={expand}>
      {t("modelsWorkspace.expandCount", { count: next.length })}
    </button>
  );
}
