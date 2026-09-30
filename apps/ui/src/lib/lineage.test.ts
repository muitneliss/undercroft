/**
 * The lineage view's arithmetic: "upstream" is the declared edges followed backwards and
 * nothing else, and a cycle -- which dbt refuses to build but a saved text may hold -- ends
 * rather than hanging the page.
 */

import { describe, expect, test as it } from "bun:test";

import type { ModelLineage } from "@/api/types.ts";
import { layout, upstreamOf } from "./lineage.ts";

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
    expect(layout(cyclic).placed.map((p) => p.node.id).sort()).toEqual(["model:x", "model:y"]);
  });
});

describe("layout", () => {
  it("puts each model one column past its deepest parent", () => {
    const columns = Object.fromEntries(layout(GRAPH).placed.map((p) => [p.node.name, p.column]));
    expect(columns).toEqual({ "raw.records": 0, a: 1, b: 2, c: 3, downstream: 4 });
  });
});
