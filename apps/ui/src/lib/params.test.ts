/**
 * What parameters promise: each hole is named once, its value is read from and written to
 * the URL under its own key, and a hole with no value is named as missing so the run is
 * refused rather than guessed.
 */

import { describe, expect, test as it } from "bun:test";
import { paramNames } from "@undercroft/contracts/bi";

import { paramsFromSearch, withParam } from "./params.ts";

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
