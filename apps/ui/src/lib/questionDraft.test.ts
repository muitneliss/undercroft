/**
 * What the question draft promises: a new question is unsaved, a loaded one is clean until
 * a change, switching to SQL keeps the text and cannot be undone by the builder, and the
 * fields' aliases are what the compiler will name the columns.
 */

import { describe, expect, test as it } from "bun:test";

import type { QuestionView } from "@/api/types.ts";
import {
  draftFromQuestion,
  fieldAliases,
  isQuestionDirty,
  newQuestionDraft,
  patchVisual,
  switchToSql,
} from "./questionDraft.ts";

const SAVED: QuestionView = {
  id: "5f1c1a9e-0c2d-4b7a-9d3e-2a6f8c1b4d10",
  name: "Deals",
  definition: {
    kind: "visual",
    table: "stg_deals",
    fields: [{ column: "stage" }, { column: "amount", aggregate: "sum" }],
    filters: [],
    groupBy: ["stage"],
    orderBy: [],
    limit: 100,
  },
  chart: { type: "table", y: [], options: {} },
  updatedAt: "2026-09-17T10:00:00.000Z",
  updatedBy: "u-1",
};

describe("questionDraft", () => {
  it("a new question is unsaved; a loaded one is clean until patched", () => {
    expect(isQuestionDirty(newQuestionDraft("CASE-0042", "stg_deals"))).toBe(true);
    const loaded = draftFromQuestion("CASE-0042", SAVED);
    expect(isQuestionDirty(loaded)).toBe(false);
    expect(isQuestionDirty(patchVisual(loaded, { limit: 50 }))).toBe(true);
    expect(isQuestionDirty({ ...loaded, name: "Deals, won" })).toBe(true);
  });

  it("switching to SQL keeps the text and the builder no longer applies", () => {
    const loaded = draftFromQuestion("CASE-0042", SAVED);
    const sql = switchToSql(loaded, 'SELECT "stage" FROM "stg_deals"');
    expect(sql.definition).toEqual({ kind: "sql", sql: 'SELECT "stage" FROM "stg_deals"' });
    expect(patchVisual(sql, { limit: 5 })).toBe(sql);
  });

  it("names the columns the compiler will answer with", () => {
    if (SAVED.definition.kind !== "visual") {
      throw new Error("fixture is visual");
    }
    expect(fieldAliases(SAVED.definition)).toEqual(["stage", "sum_amount"]);
    const fresh = newQuestionDraft("x", "t");
    if (fresh.definition.kind !== "visual") {
      throw new Error("a new question over a table is visual");
    }
    expect(fieldAliases(fresh.definition)).toEqual(["count"]);
  });
});
