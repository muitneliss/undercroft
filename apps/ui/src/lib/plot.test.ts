/**
 * What plotting promises: a numeric string becomes a position and nothing readable, an
 * unreadable cell or a null is a gap and never a zero, and a text column is not plotted
 * however numeric its contents look.
 */

import { describe, expect, test as it } from "bun:test";

import { plotValue } from "./plot.ts";

describe("plotValue", () => {
  it("reads a numeric string as a position, refuses the unreadable, leaves gaps for null", () => {
    expect(plotValue("12345.6789", "numeric")).toBe(12_345.6789);
    expect(plotValue("42", "bigint")).toBe(42);
    expect(plotValue(7, "integer")).toBe(7);
    expect(plotValue(true, "boolean")).toBe(1);
    expect(plotValue(null, "numeric")).toBeNull();
    expect(plotValue("twelve", "numeric")).toBeNull();
    // A text column is not a number, whatever it holds: "0042" is an id, not forty-two.
    expect(plotValue("0042", "text")).toBeNull();
  });
});
