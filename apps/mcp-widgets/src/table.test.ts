/**
 * The grid prints a cell the way the web UI's `ResultTable` does, and the money rule is the
 * reason it matters: a `numeric` arrives as a string and must reach the screen digit for digit,
 * and a missing value must read as missing, never as an empty cell or a zero.
 */

import { describe, expect, test as it } from "bun:test";
import { MISSING } from "@undercroft/core/money";
import { wordsFor } from "./i18n.ts";
import { cellText, gridOf } from "./table.ts";

const t = wordsFor("en");

describe("a query result in the grid", () => {
  it("prints an amount verbatim and a missing one as missing", () => {
    const grid = gridOf(
      "bi.answer",
      {
        columns: [{ name: "amount", type: "numeric" }],
        rows: [["12345678901234567890.1234"], [null]],
        truncated: false,
      },
      t,
    );

    expect(grid?.rows.map(([cell]) => cellText(cell ?? null, "en", t))).toEqual([
      "12345678901234567890.1234",
      MISSING,
    ]);
  });

  it("is not drawn for a procedure the grid does not draw", () => {
    expect(gridOf("runs.get", { id: "run-1" }, t)).toBeNull();
  });
});
