/**
 * Which model each test of a build tests, read from dbt's manifest: exactly the node dbt hangs
 * it off, and nobody's when the manifest does not say -- never a guess from the test's name.
 */

import { describe, expect, test as it } from "bun:test";

import { testedModels } from "./dbtManifest.ts";

describe("testedModels", () => {
  it("attributes each test to the model dbt's manifest names, never to a reading of its name", () => {
    // `not_null_a_b_c` is column `b_c` of `a` or column `c` of `a_b`: only the manifest knows.
    const byTest = testedModels({
      nodes: {
        "model.undercroft.a": { depends_on: { nodes: [] } },
        "test.undercroft.not_null_a_b_c.1": {
          attached_node: "model.undercroft.a_b",
          depends_on: { nodes: ["model.undercroft.a_b"] },
        },
        // A generic test hangs off its model even when it reads another (a relationships test).
        "test.undercroft.relationships_fct_owner_id.2": {
          attached_node: "model.undercroft.fct",
          depends_on: { nodes: ["model.undercroft.dim_owner", "model.undercroft.fct"] },
        },
        // A SQL test (ADR 0130) has no attached node: the model it is named for and reads...
        "test.undercroft.fct__totals_balance.3": {
          attached_node: null,
          depends_on: { macros: [], nodes: ["model.undercroft.fct"] },
        },
        // ...also when it reads others beside it...
        "test.undercroft.fct__owners_known.4": {
          depends_on: { nodes: ["model.undercroft.dim_owner", "model.undercroft.fct"] },
        },
        // ...and named for a model it does not read, it is nobody's, not the one it reads...
        "test.undercroft.fct__reads_another.6": {
          depends_on: { nodes: ["model.undercroft.dim_owner"] },
        },
        // ...and with no such lead, reading several, it is nobody's rather than a guess.
        "test.undercroft.owners_match.5": {
          depends_on: { nodes: ["model.undercroft.dim_owner", "model.undercroft.fct"] },
        },
      },
    });

    expect(Object.fromEntries(byTest)).toEqual({
      "test.undercroft.not_null_a_b_c.1": "a_b",
      "test.undercroft.relationships_fct_owner_id.2": "fct",
      "test.undercroft.fct__totals_balance.3": "fct",
      "test.undercroft.fct__owners_known.4": "fct",
    });
  });

  it("a manifest that is not dbt's shape attributes nothing", () => {
    expect(testedModels(null).size).toBe(0);
    expect(testedModels({ nodes: "no" }).size).toBe(0);
  });
});
