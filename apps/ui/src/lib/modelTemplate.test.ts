/**
 * What the template promises: it names the model it was made for, reads the platform's
 * source, and carries the money rule so the first model an author sees already holds it.
 */

import { describe, expect, test as it } from "bun:test";

import { modelTemplate } from "./modelTemplate.ts";

describe("modelTemplate", () => {
  it("names the model, reads raw.records through the source, and parses money the platform's way", () => {
    const sql = modelTemplate("stg_deals");

    expect(sql.startsWith("-- stg_deals:")).toBe(true);
    expect(sql).toContain("{{ source('undercroft', 'records') }}");
    expect(sql).toContain("parse_amount(");
    expect(sql).toContain("deleted_at is null");
  });
});
