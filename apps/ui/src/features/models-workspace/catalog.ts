import type { Catalog, Direction, ModelRecord } from "./types.ts";
export const PAGE_SIZE = 25;
export const GRAPH_LIMIT = 12;

export function groupKey(model: ModelRecord, layer: string): string {
  if (layer === "input") {
    if (model.coverage !== "complete") {
      return "unknown";
    }
    if (model.sources.length === 0) {
      return "none";
    }
    return model.sources.length > 1 ? "multiple" : (model.sources[0] ?? "unknown");
  }
  if (layer === "transform" || layer === "output") {
    return model.domain ?? "unknown";
  }
  if (layer === "unclassified") {
    return model.family ?? "unknown";
  }
  return model.layer;
}
export function filteredModels(catalog: Catalog, params: URLSearchParams): ModelRecord[] {
  const query = (params.get("q") ?? "").trim().toLocaleLowerCase();
  const layer = params.get("layer");
  const domain = params.get("domain");
  const source = params.get("source");
  const family = params.get("fam");
  const legacy: Record<string, string> = {
    ok: "success",
    failed: "failed",
    never: "never",
    other: "other",
  };
  const build = params.get("build");
  const status = params.get("status") ?? (build ? legacy[build] : null);
  return catalog.models.filter((model) => {
    const searchable = [
      model.id,
      model.title.vi,
      model.title.en,
      model.description.vi,
      model.description.en,
    ]
      .join(" ")
      .toLocaleLowerCase();
    return (
      (!layer || model.layer === layer) &&
      (!domain || (model.domain ?? "unknown") === domain) &&
      (!source ||
        (source === "unknown" ? model.coverage !== "complete" : model.sources.includes(source))) &&
      (!family || model.family === family) &&
      (!status ||
        (status === "other"
          ? ["queued", "running"].includes(model.status)
          : model.status === status)) &&
      (!query || searchable.includes(query))
    );
  });
}
export function orderedModels(
  models: ModelRecord[],
  layer: string,
  sort: string,
  locale: "vi" | "en",
): ModelRecord[] {
  return [...models].sort((left, right) => {
    const order = ["input", "transform", "output", "unclassified"];
    const group = layer
      ? groupKey(left, layer).localeCompare(groupKey(right, layer))
      : order.indexOf(left.layer) - order.indexOf(right.layer);
    if (group !== 0) {
      return group;
    }
    if (sort === "build_desc") {
      return (
        (right.builtAt ?? "").localeCompare(left.builtAt ?? "") || left.id.localeCompare(right.id)
      );
    }
    const nameOrder =
      left.title[locale].localeCompare(right.title[locale], locale) ||
      left.id.localeCompare(right.id);
    return sort === "name_desc" ? -nameOrder : nameOrder;
  });
}

interface Relation {
  distance: number;
  direction: "up" | "down";
}
/** Each direction has its own visited set, so shared parents do not introduce siblings. */
export function related(
  catalog: Catalog,
  root: string,
  direction: Direction,
  depth: number,
): Map<string, Relation> {
  const result = new Map<string, Relation>();
  for (const side of ["up", "down"] as const) {
    if (direction !== "both" && side !== direction) {
      continue;
    }
    for (const [id, distance] of walk(catalog, root, side, depth)) {
      if (!result.has(id)) {
        result.set(id, { distance, direction: side });
      }
    }
  }
  return result;
}
function walk(
  catalog: Catalog,
  root: string,
  side: "up" | "down",
  depth: number,
): Map<string, number> {
  const adjacency = adjacencyFor(catalog, side);
  const found = new Map<string, number>([[root, 0]]);
  const queue = [root];
  for (const id of queue) {
    const step = (found.get(id) ?? 0) + 1;
    if (step > depth) {
      continue;
    }
    for (const next of adjacency.get(id) ?? []) {
      if (found.has(next)) {
        continue;
      }
      found.set(next, step);
      queue.push(next);
    }
  }
  found.delete(root);
  return found;
}
export function scopeIds(
  catalog: Catalog,
  root: string,
  direction: Direction,
  options: { depth: number; expanded: string[] },
): string[] {
  const { depth, expanded } = options;
  const ids = new Set([root, ...related(catalog, root, direction, depth).keys()]);
  for (const id of expanded) {
    if (!ids.has(id)) {
      continue;
    }
    for (const next of related(catalog, id, direction, 1).keys()) {
      ids.add(next);
    }
  }
  return [...ids];
}

function adjacencyFor(catalog: Catalog, side: "up" | "down"): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of catalog.edges) {
    const from = side === "up" ? edge.target : edge.source;
    const to = side === "up" ? edge.source : edge.target;
    adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
  }
  return adjacency;
}
