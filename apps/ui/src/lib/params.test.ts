/**
 * What parameters promise: each hole is named once, its value is read from and written to
 * the URL under its own key, and a hole with no value is named as missing so the run is
 * refused rather than guessed -- and asking which holes a question HAS never throws, so a
 * saved question that will not compile costs one tile rather than the whole page.
 */

import { describe, expect, test as it } from "bun:test";
import { paramNames, type QuestionDefinition } from "@undercroft/contracts/bi";

import { paramsFromSearch, questionParams, withParam } from "./params.ts";

describe("params", () => {
  it("names each hole once and reads its value from the URL, naming the ones with none", () => {
    const names = paramNames("select * from t where d >= {{from}} and d < {{to}} and x = {{from}}");
    expect(names).toEqual(["from", "to"]);

    const bound = paramsFromSearch(new URLSearchParams("p.from=2026-01-01&other=1"), names);
    expect(bound.params).toEqual({ from: "2026-01-01" });
    expect(bound.missing).toEqual(["to"]);
  });

  it("writes a value under its own key and removes it when emptied", () => {
    const set = withParam(new URLSearchParams("q=1"), "to", "2026-02-01");
    expect(set.toString()).toBe("q=1&p.to=2026-02-01");
    expect(withParam(set, "to", "").toString()).toBe("q=1");
  });
});

describe("the holes a saved question asks for", () => {
  it("names them, for a question written in the builder", () => {
    const narrowed: QuestionDefinition = {
      kind: "visual",
      table: "orders",
      fields: [{ column: "total", aggregate: "sum" }],
      filters: [{ column: "total", op: "gte", value: "{{min_amount}}" }],
      groupBy: [],
      orderBy: [],
      limit: 100,
    };
    expect(questionParams(narrowed)).toEqual(["min_amount"]);
  });

  it("answers none, rather than throwing, for one the compiler refuses", () => {
    // An operator that takes a value, with the value gone: what changing a filter's column
    // leaves behind, and what `saveQuestion` stores without compiling. A dashboard tile asks
    // this during render, and the SPA has no error boundary to catch a throw.
    const broken: QuestionDefinition = {
      kind: "visual",
      table: "orders",
      fields: [{ column: "total" }],
      filters: [{ column: "total", op: "gte" }],
      groupBy: [],
      orderBy: [],
      limit: 100,
    };
    expect(questionParams(broken)).toEqual([]);
  });
});
