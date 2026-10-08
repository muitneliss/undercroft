/**
 * The lineage view's arithmetic: "upstream" is the declared edges followed backwards and
 * nothing else, and a cycle -- which dbt refuses to build but a saved text may hold -- ends
 * rather than hanging the page.
 */

import { describe, expect, test as it } from "bun:test";

import type { ModelLineage } from "@/api/types.ts";
import { upstreamOf, upstreamPaths } from "./lineage.ts";
import { arrange, CARD_H, CARD_W, type Point, type Route } from "./lineageArrange.ts";
import { layout } from "./lineageLayout.ts";

function model(name: string): ModelLineage["nodes"][number] {
  return { kind: "model", id: `model:${name}`, name, undeclared: [] };
}

function edge(from: string, to: string): ModelLineage["edges"][number] {
  return { from, to, via: null };
}

const GRAPH: ModelLineage = {
  nodes: [
    { kind: "raw", id: "raw:raw.records", name: "raw.records" },
    model("a"),
    model("b"),
    model("c"),
    model("downstream"),
  ],
  edges: [
    edge("raw:raw.records", "model:a"),
    edge("model:a", "model:b"),
    edge("model:b", "model:c"),
    edge("model:c", "model:downstream"),
  ],
};

describe("upstreamOf", () => {
  it("follows every declared edge back to the raw lake, and never forward", () => {
    expect([...upstreamOf(GRAPH, "model:c")].sort()).toEqual([
      "model:a",
      "model:b",
      "model:c",
      "raw:raw.records",
    ]);
  });

  it("ends on a cycle, and lays it out", () => {
    const cyclic: ModelLineage = {
      nodes: [model("x"), model("y")],
      edges: [edge("model:x", "model:y"), edge("model:y", "model:x")],
    };
    expect([...upstreamOf(cyclic, "model:x")].sort()).toEqual(["model:x", "model:y"]);
    expect(
      layout(cyclic)
        .placed.map((p) => p.node.id)
        .sort(),
    ).toEqual(["model:x", "model:y"]);
  });
});

describe("upstreamPaths", () => {
  it("stops writing paths at its limit and says there are more, rather than look complete", () => {
    // Three raw tables into one model: three paths, asked for two.
    const wide: ModelLineage = {
      nodes: [
        { kind: "raw", id: "raw:r1", name: "r1" },
        { kind: "raw", id: "raw:r2", name: "r2" },
        { kind: "raw", id: "raw:r3", name: "r3" },
        model("m"),
      ],
      edges: [edge("raw:r1", "model:m"), edge("raw:r2", "model:m"), edge("raw:r3", "model:m")],
    };
    const { paths, more } = upstreamPaths(wide, "model:m", 2);
    expect(paths).toHaveLength(2);
    expect(more).toBe(true);
  });
});

describe("layout", () => {
  it("puts each model one column past its deepest parent", () => {
    const columns = Object.fromEntries(layout(GRAPH).placed.map((p) => [p.node.name, p.column]));
    expect(columns).toEqual({ "raw.records": 0, a: 1, b: 2, c: 3, downstream: 4 });
  });
});

/** Points along a route's Bézier segments, close enough together to catch a crossed card. */
function along(route: Route): Point[] {
  const points: Point[] = [];
  for (let at = 0; at + 3 < route.length; at += 3) {
    const [p0, p1, p2, p3] = route.slice(at, at + 4) as [Point, Point, Point, Point];
    for (let step = 0; step <= 50; step += 1) {
      const t = step / 50;
      const [a, b, c, d] = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3];
      points.push({
        x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
        y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
      });
    }
  }
  return points;
}

describe("arrange", () => {
  // raw.records feeds c directly as well as through a and b: one edge spans three columns.
  const SPANNING: ModelLineage = {
    ...GRAPH,
    edges: [...GRAPH.edges, edge("raw:raw.records", "model:c")],
  };

  it("keeps every node in the column its longest chain gives it, joined to the rest or not", async () => {
    // `lone` declares no upstream, so it stands in the first model column with nothing drawn
    // to it; ELK once laid such a part out apart and put it in the raw lake's column.
    const apart: ModelLineage = { ...SPANNING, nodes: [...SPANNING.nodes, model("lone")] };
    const arranged = await arrange(apart, apart);
    const lefts = arranged?.columns.map((c) => c.x) ?? [];
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
    expect(
      ["raw:raw.records", "model:a", "model:b", "model:c", "model:downstream"].map(
        (id) => arranged?.cards.get(id)?.x,
      ),
    ).toEqual(lefts);
    expect(arranged?.cards.get("model:lone")?.x).toBe(arranged?.cards.get("model:a")?.x);
    expect(arranged?.columns.map((c) => c.column)).toEqual([0, 1, 2, 3, 4]);
  });

  it("routes an edge that spans columns between the cards it does not join, not over them", async () => {
    const arranged = await arrange(SPANNING, SPANNING);
    const route = arranged?.routes.get("raw:raw.records|model:c") ?? [];
    const passed = ["model:a", "model:b"].filter((id) => {
      const card = arranged?.cards.get(id);
      return along(route).some(
        (p) =>
          card !== undefined &&
          p.x > card.x &&
          p.x < card.x + CARD_W &&
          p.y > card.y &&
          p.y < card.y + CARD_H,
      );
    });
    expect(route.length).toBeGreaterThan(1);
    expect(passed).toEqual([]);
  });

  it("lays out a cycle rather than refusing it", async () => {
    const cyclic: ModelLineage = {
      nodes: [model("x"), model("y")],
      edges: [edge("model:x", "model:y"), edge("model:y", "model:x")],
    };
    const arranged = await arrange(cyclic, cyclic);
    expect([...(arranged?.cards.keys() ?? [])].sort()).toEqual(["model:x", "model:y"]);
    expect(arranged?.routes.size).toBe(2);
  });
});
