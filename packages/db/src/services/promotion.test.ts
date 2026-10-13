/**
 * Which of a build's nodes may be published (ADR 0131): what built, whose own tests passed or
 * warned, and whose parents in the same build were published too. Every rule that holds a node
 * back is pinned, and so is each one that must not.
 */

import { describe, expect, test as it } from "bun:test";

import type { RunStep } from "../repos/runs.ts";
import { buildGraph } from "./dbtManifest.ts";
import { promotable } from "./promotion.ts";

function node(name: string, status = "success", kind: "model" | "seed" = "model"): RunStep {
  return {
    uniqueId: `${kind}.undercroft.${name}`,
    kind,
    name,
    status,
    failures: null,
    relation: null,
    message: null,
    executionMs: 1,
  };
}

function test(name: string, status: string, model: string | null): RunStep {
  return {
    uniqueId: `test.undercroft.${name}.a1`,
    kind: "test",
    name,
    status,
    failures: status === "fail" ? 1 : 0,
    relation: null,
    message: null,
    executionMs: 1,
    model,
  };
}

/** stg reads the seed; fct reads stg. */
const GRAPH = {
  parents: new Map([
    ["groups", []],
    ["stg", ["groups"]],
    ["fct", ["stg"]],
    ["dim", []],
  ]),
  testReads: new Map([["test.undercroft.loose.a1", ["stg"]]]),
};

describe("promotable", () => {
  it("publishes what built with every test passing or warning", () => {
    const steps = [
      node("groups", "success", "seed"),
      node("stg"),
      test("not_null_stg_id", "pass", "stg"),
      node("fct"),
      test("not_null_fct_id", "warn", "fct"),
    ];
    expect(promotable(steps, GRAPH)).toEqual(new Set(["groups", "stg", "fct"]));
  });

  it("holds a node whose own test failed, errored or did not run, and every child built over it", () => {
    for (const status of ["fail", "error", "skipped"]) {
      const steps = [node("stg"), test("not_null_stg_id", status, "stg"), node("fct")];
      expect(promotable(steps, GRAPH)).toEqual(new Set());
    }
  });

  it("holds a node that did not build, and keeps a parent outside the build from holding anything", () => {
    expect(promotable([node("stg", "error"), node("fct", "skipped")], GRAPH)).toEqual(new Set());
    // stg is not in this build: fct read its published version, which holds nothing back.
    expect(promotable([node("fct")], GRAPH)).toEqual(new Set(["fct"]));
  });

  it("a failing test it cannot place holds what it reads, and without a manifest holds all", () => {
    const steps = [node("stg"), node("fct"), test("loose", "fail", null)];
    expect(promotable(steps, GRAPH)).toEqual(new Set());
    const unread = { parents: new Map<string, string[]>(), testReads: new Map<string, string[]>() };
    expect(promotable([node("dim"), test("loose", "fail", null)], unread)).toEqual(new Set());
  });

  it("a node whose parents are not known waits on every other node of the build", () => {
    const unknown = {
      parents: new Map<string, string[]>(),
      testReads: new Map<string, string[]>(),
    };
    expect(promotable([node("a"), node("b")], unknown)).toEqual(new Set(["a", "b"]));
    expect(promotable([node("a"), node("b", "error")], unknown)).toEqual(new Set());
  });

  // dbt inlines an ephemeral model into its readers and reports no step for it, so a child
  // reading a held table through one must still be held with that table.
  it("reads through an ephemeral model to the table under it, held or published", () => {
    const graph = buildGraph({
      nodes: {
        "model.undercroft.base": { depends_on: { nodes: [] }, config: { materialized: "table" } },
        "model.undercroft.inlined": {
          depends_on: { nodes: ["model.undercroft.base"] },
          config: { materialized: "ephemeral" },
        },
        "model.undercroft.report": {
          depends_on: { nodes: ["model.undercroft.inlined"] },
          config: { materialized: "table" },
        },
      },
    });
    expect(graph.parents.get("report")).toEqual(["base"]);
    const steps = [node("base"), node("report")];
    expect(promotable(steps, graph, new Set(["base"]))).toEqual(new Set());
    expect(promotable(steps, graph)).toEqual(new Set(["base", "report"]));
  });

  it("holds what the caller holds, and the children built over it", () => {
    const steps = [node("stg"), node("fct"), node("dim")];
    expect(promotable(steps, GRAPH, new Set(["stg"]))).toEqual(new Set(["dim"]));
  });
});
