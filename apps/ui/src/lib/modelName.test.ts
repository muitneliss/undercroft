/**
 * What the name rule promises: a plain lowercase identifier is a model name, and the three
 * ways a person most often breaks it -- a capital, a hyphen, a leading digit -- are refused
 * at the field rather than by the server.
 */

import { describe, expect, test as it } from "bun:test";

import { isModelName } from "./modelName.ts";

describe("isModelName", () => {
  it("accepts a plain lowercase identifier and refuses what dbt or Postgres would choke on", () => {
    expect(isModelName("stg_deals")).toBe(true);
    expect(isModelName("stg_deals_2026")).toBe(true);
    expect(isModelName("Deals")).toBe(false);
    expect(isModelName("stg-deals")).toBe(false);
    expect(isModelName("1x")).toBe(false);
    expect(isModelName("")).toBe(false);
    expect(isModelName("a".repeat(64))).toBe(false);
  });
});
