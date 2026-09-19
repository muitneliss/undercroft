/**
 * What the draft promises: a model just seeded is not unsaved, a changed line or a changed
 * test is, reordering a column's tests is not, and what leaves for the server is the
 * contract's shape.
 */

// biome-ignore-all lint/style/useNamingConvention: `not_null` and `deal_id` are dbt's own test name and a column name as SQL spells it; a camelCase spelling would be a second name for the same thing.

import { describe, expect, test as it } from "bun:test";

import type { ModelDetail } from "@/api/types.ts";
import { draftFrom, isDirty, testsFor } from "./modelDraft.ts";

const MODEL: ModelDetail = {
  name: "stg_deals",
  sql: "select 1 as deal_id",
  tests: { columns: { deal_id: ["not_null", "unique"] } },
  updatedAt: "2026-09-17T10:00:00.000Z",
  updatedBy: "u-1",
  lastBuild: null,
};

describe("modelDraft", () => {
  it("is clean when seeded, unsaved once the SQL or a test changes, and indifferent to order", () => {
    const seeded = draftFrom("CASE-0042", MODEL);
    expect(isDirty(seeded)).toBe(false);

    expect(isDirty({ ...seeded, sql: "select 2 as deal_id" })).toBe(true);
    expect(isDirty({ ...seeded, tests: { deal_id: ["not_null"] } })).toBe(true);
    expect(isDirty({ ...seeded, tests: { deal_id: ["unique", "not_null"] } })).toBe(false);
    expect(isDirty({ ...seeded, tests: { ...seeded.tests, amount: [] } })).toBe(true);
  });

  it("hands the server the contract's shape", () => {
    const seeded = draftFrom("CASE-0042", MODEL);
    expect(testsFor({ ...seeded, tests: { deal_id: ["unique"], amount: [] } })).toEqual({
      columns: { deal_id: ["unique"], amount: [] },
    });
  });
});
