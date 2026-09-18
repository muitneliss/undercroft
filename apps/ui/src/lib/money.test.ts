/**
 * Money must survive the browser.
 *
 * The backend keeps monetary amounts in Decimal, stores them NUMERIC(18,4), and
 * sends them as strings specifically so this layer cannot round them. These
 * tests are the other half of that guarantee: they fail if anyone "simplifies"
 * formatMoney into something that parses.
 */

// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { describe, expect, test as it, test } from "bun:test";

import { exactAmount, formatCount, formatMoney, MISSING, orMissing } from "./money.ts";

describe("formatMoney", () => {
  it("keeps every digit of an amount a double could not hold", () => {
    // 9007199254740993 is 2^53 + 1: the first integer a float cannot represent.
    const money = { amount: "9007199254740993.0001", currency: "SGD" };

    expect(formatMoney(money, 4)).toBe("9,007,199,254,740,993.0001 SGD");
  });

  it("does not round when trimming to two places", () => {
    // Rounding here would invent a figure. Truncation is visibly a display
    // choice; a rounded total looks like the real one.
    expect(formatMoney({ amount: "1.999", currency: "SGD" })).toBe("1.99 SGD");
  });

  it("pads a short fraction rather than shifting the digits", () => {
    expect(formatMoney({ amount: "8500.5", currency: "SGD" })).toBe("8,500.50 SGD");
  });

  it("carries the currency, because two currencies are not comparable", () => {
    expect(formatMoney({ amount: "10.00", currency: "VND" })).toContain("VND");
  });

  it("renders a negative amount as negative", () => {
    expect(formatMoney({ amount: "-42.00", currency: "SGD" })).toBe("-42.00 SGD");
  });

  it("renders a missing amount as missing, never as zero", () => {
    // An empty cell is visibly missing; a zero is invisibly false.
    expect(formatMoney(null)).toBe(MISSING);
    expect(formatMoney(undefined)).toBe(MISSING);
    expect(formatMoney(null)).not.toBe("0.00");
  });

  it("reports an unreadable amount as missing rather than guessing", () => {
    expect(formatMoney({ amount: "not a number", currency: "SGD" })).toBe(MISSING);
  });

  it("exposes the exact digits for a tooltip", () => {
    expect(exactAmount({ amount: "1.999", currency: "SGD" })).toBe("1.999 SGD");
  });
});

describe("counts and absences", () => {
  it("a count is a real number and may be grouped", () => {
    expect(formatCount(1234)).toBe("1,234");
  });

  it("zero rows is zero, not missing", () => {
    // The distinction that matters: a count of 0 is a fact. A null is not.
    expect(formatCount(0)).toBe("0");
    expect(formatCount(null)).toBe(MISSING);
  });

  it("an empty string renders as missing rather than as blank space", () => {
    expect(orMissing("")).toBe(MISSING);
    expect(orMissing("CASE-A1B2C3")).toBe("CASE-A1B2C3");
  });
});
