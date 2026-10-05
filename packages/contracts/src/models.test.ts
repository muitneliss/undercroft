/**
 * What a business context must say before it is complete, and what it may never say.
 *
 * `missingSections` is the one judge of `incomplete` for the server and the browser alike, so
 * each section is pinned from both sides: the answer that completes it, and the half-answer
 * that does not. A key is the section a draft most easily half-answers -- declared with no
 * columns, or declared absent with no reason -- and a rule list left empty is a question not
 * yet asked, where `none` is an answer.
 */

import { describe, expect, test as it } from "bun:test";

import { missingSections, ModelContext } from "./index.ts";

const COMPLETE = {
  purpose: "One row per open deal, for the pipeline report.",
  grain: "One deal.",
  key: { kind: "declared", columns: ["deal_id"] },
  columns: [{ name: "deal_id", definition: "The deal's id in the CRM." }],
  rules: { kind: "none" },
} as const;

function context(overrides: Record<string, unknown>): ModelContext {
  return ModelContext.parse({ ...COMPLETE, ...overrides });
}

describe("missingSections", () => {
  it("a composite key, and no key with a reason, both answer the key", () => {
    expect(
      missingSections(context({ key: { kind: "declared", columns: ["deal_id", "stage"] } })),
    ).toEqual([]);
    expect(
      missingSections(context({ key: { kind: "none", reason: "An event log; rows repeat." } })),
    ).toEqual([]);
  });

  it("no key, a key with no columns, or none with a blank reason leaves exactly the key", () => {
    expect(missingSections(context({ key: null }))).toEqual(["key"]);
    expect(missingSections(context({ key: { kind: "declared", columns: [] } }))).toEqual(["key"]);
    expect(missingSections(context({ key: { kind: "none", reason: "  " } }))).toEqual(["key"]);
  });

  it("rules: none is an answer; an empty list is not", () => {
    expect(missingSections(context({ rules: { kind: "none" } }))).toEqual([]);
    expect(missingSections(context({ rules: { kind: "listed", items: [] } }))).toEqual(["rules"]);
  });

  it("no context at all misses every section, in the order a reader is asked", () => {
    expect(missingSections(null)).toEqual(["purpose", "grain", "key", "columns", "rules"]);
  });
});

describe("ModelContext", () => {
  it("refuses a key that is both declared and declared absent", () => {
    const both = { kind: "declared", columns: ["deal_id"], reason: "none" };
    expect(ModelContext.safeParse({ ...COMPLETE, key: both }).success).toBe(false);
  });

  it("refuses a column defined twice", () => {
    const twice = [
      { name: "deal_id", definition: "The id." },
      { name: "deal_id", definition: "Another id." },
    ];
    expect(ModelContext.safeParse({ ...COMPLETE, columns: twice }).success).toBe(false);
    expect(ModelContext.safeParse(COMPLETE).success).toBe(true);
  });
});
