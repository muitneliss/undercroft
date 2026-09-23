import { describe, expect, test as it } from "bun:test";
import {
  add,
  compare,
  currency,
  formatMoney,
  MISSING,
  money,
  parseAmount,
  sub,
  toBig,
} from "./money.ts";

const SGD = currency("SGD");
const USD = currency("USD");

function amount(text: string) {
  return money(parseAmount(text), SGD);
}

describe("parseAmount reads exactly or not at all", () => {
  it.each([
    ["1234.56", "1234.56"],
    ["1,234.56", "1234.56"],
    ["$1,234.56", "1234.56"],
    ["1234.56 SGD", "1234.56"],
    ["-42", "-42"],
    ["+42", "42"],
    ["0", "0"],
    ["1 234.56", "1234.56"],
    ["1'234.56", "1234.56"],
    ["8500.0001", "8500.0001"],
    // 25 significant digits: further than a double reaches, which is the point.
    ["1234567890123456789012345", "1234567890123456789012345"],
  ])("reads %p as %p", (input, expected) => {
    expect(parseAmount(input)?.toString()).toBe(expected);
  });

  it.each([[""], [null], [undefined], ["-"], ["+"], ["."], ["abc"], ["$"]])(
    "returns null for %p rather than guessing",
    (input) => {
      // Never zero: a zero is indistinguishable from a real zero downstream, so returning
      // one here is data loss that looks like a fact.
      expect(parseAmount(input)).toBeNull();
    },
  );

  it("refuses European notation instead of picking a reading", () => {
    // "1.234,00" is 1234 in Europe and 1.234 read as US notation -- a factor of a
    // thousand apart. Only the source system knows which it meant.
    expect(parseAmount("1.234,00")).toBeNull();
  });

  it("a boolean is not an amount", () => {
    expect(parseAmount(true as unknown as string)).toBeNull();
  });

  it("a bigint is read exactly", () => {
    expect(parseAmount(90071992547409911n)?.toString()).toBe("90071992547409911");
  });

  it("throws on a number rather than laundering the precision loss upstream", () => {
    expect(() => parseAmount(1234.56 as unknown as string)).toThrow(/already happened upstream/u);
  });
});

describe("currency is never implicit", () => {
  it("rejects anything that is not an ISO 4217 alpha-3 code", () => {
    expect(() => currency("sgd")).toThrow(/ISO 4217/u);
    expect(() => currency("SGDX")).toThrow(/ISO 4217/u);
  });

  it("adds two amounts in the same currency", () => {
    expect(add(amount("10.50")!, amount("0.25")!).amount as string).toBe("10.7500");
  });

  it("refuses to add across currencies rather than converting silently", () => {
    const sgd = money(parseAmount("10"), SGD)!;
    const usd = money(parseAmount("10"), USD)!;
    expect(() => add(sgd, usd)).toThrow(/dated FX rate/u);
  });

  it("subtracts without floating point drift", () => {
    // 0.1 + 0.2 - 0.3 is the canonical float failure; here it is exactly zero.
    const left = add(amount("0.1")!, amount("0.2")!);
    expect(sub(left, amount("0.3")!).amount as string).toBe("0.0000");
  });
});

describe("compare is three-valued", () => {
  it("agrees within tolerance", () => {
    expect(compare(amount("100.00"), amount("100.01"))).toBe("ok");
  });

  it("disagrees beyond tolerance", () => {
    expect(compare(amount("100.00"), amount("105.00"))).toBe("mismatch");
  });

  it("missing evidence is unverified, never ok", () => {
    expect(compare(null, amount("100.00"))).toBe("unverified");
    expect(compare(amount("100.00"), null)).toBe("unverified");
  });

  it("a currency mismatch is unverified, not a mismatch", () => {
    // 4,000 SGD and 4,000 USD are not in agreement, but neither have we shown
    // they disagree. Calling it a mismatch sends someone to investigate a
    // discrepancy that may not exist.
    const sgd = money(parseAmount("4000"), SGD);
    const usd = money(parseAmount("4000"), USD);
    expect(compare(sgd, usd)).toBe("unverified");
  });
});

describe("formatMoney", () => {
  it("renders a missing amount as the em dash, never as zero", () => {
    expect(formatMoney(null)).toBe(MISSING);
    expect(formatMoney(null)).not.toBe("0.00");
  });

  it("truncates rather than rounding, so no hundredth of a cent is invented", () => {
    expect(formatMoney(amount("8500.0001"))).toBe("8,500.00");
    expect(formatMoney(amount("8500.9999"))).toBe("8,500.99");
  });

  it("groups thousands and keeps the sign", () => {
    expect(formatMoney(amount("1234567.5"))).toBe("1,234,567.50");
    expect(formatMoney(amount("-1234.5"))).toBe("-1,234.50");
  });

  it("the exact stored value survives formatting", () => {
    const exact = amount("8500.0001")!;
    expect(formatMoney(exact)).toBe("8,500.00");
    expect(toBig(exact).toString()).toBe("8500.0001");
  });
});
