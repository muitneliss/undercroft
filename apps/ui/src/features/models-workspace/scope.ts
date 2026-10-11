import { GRAPH_LIMIT, scopeIds } from "./catalog.ts";
import type { Catalog, Direction } from "./types.ts";
export function scopeFacts(
  catalog: Catalog,
  root: string,
  params: URLSearchParams,
): { direction: Direction; depthValue: string; ids: string[]; visible: string[] } {
  const direction: Direction =
    params.get("dir") === "up" ? "up" : params.get("dir") === "down" ? "down" : "both";
  const depthValue = params.get("depth") ?? (params.get("scope") === "related" ? "all" : "1");
  const depth =
    depthValue === "all" ? catalog.models.length + 2 : Number.parseInt(depthValue, 10) || 1;
  const ids = scopeIds(catalog, root, direction, {
    depth,
    expanded: params.get("expanded")?.split(",").filter(Boolean) ?? [],
  });
  const chosen = params.get("shown")?.split(",") ?? [];
  const visible =
    chosen.length > 0
      ? [root, ...chosen.filter((id) => id !== root && ids.includes(id))].slice(0, GRAPH_LIMIT)
      : ids.slice(0, 5);
  return { direction, depthValue, ids, visible };
}
