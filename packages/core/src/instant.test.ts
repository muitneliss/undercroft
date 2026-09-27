import { describe, expect, test as it } from "bun:test";
import { isoFromMillis, isoInstant, msJsonDateMillis } from "./instant.ts";

describe("isoInstant", () => {
  it.each([
    ["2026-01-01T00:00:00Z"],
    ["2019-10-30T03:30:17.883Z"],
    // Microseconds survive, which a round trip through `Date` would truncate.
    ["2026-01-01T00:00:00.123456Z"],
    ["2026-01-01T07:00:00+07:00"],
    ["2026-01-01T00:00Z"],
  ])("hands back %p as it arrived", (text) => {
    expect(isoInstant(text)).toBe(text);
  });

  it("reads a Microsoft JSON date as the instant it counts to", () => {
    expect(isoInstant("/Date(1573755038314+0000)/")).toBe("2019-11-14T18:10:38.314Z");
  });

  it("reads one that carries no offset", () => {
    expect(isoInstant("/Date(1550793549392)/")).toBe("2019-02-21T23:59:09.392Z");
  });

  it("does not move the instant by the offset, which only says where it was written", () => {
    // The count is milliseconds since the UTC epoch whatever follows it; applying the offset
    // a second time would shift every value by thirteen hours.
    expect(isoInstant("/Date(1573755038314+1300)/")).toBe("2019-11-14T18:10:38.314Z");
  });

  it.each([
    [""],
    ["yesterday"],
    ["March 7"],
    // A date with no time and a time with no offset each name a moment only in a timezone
    // the text does not give, and Postgres would supply its own.
    ["2026-01-01"],
    ["2026-01-01T00:00:00"],
    // Bun's `Date.parse` rolls these over to a day that was never written.
    ["2026-02-30T00:00:00Z"],
    ["2026-01-01T24:00:00Z"],
    ["2026-13-01T00:00:00Z"],
    ["/Date(abc)/"],
    ["/Date(1573755038314+0000)"],
    ["/Date(99999999999999999999)/"],
  ])("names no instant for %p", (text) => {
    expect(isoInstant(text)).toBeNull();
  });
});

describe("msJsonDateMillis", () => {
  it("is the count inside the parentheses", () => {
    expect(msJsonDateMillis("/Date(1573755038314+0000)/")).toBe(1573755038314n);
  });

  it("keeps a count before the epoch", () => {
    expect(msJsonDateMillis("/Date(-86400000)/")).toBe(-86400000n);
  });

  it("is null for anything else, an ISO datetime included", () => {
    expect(msJsonDateMillis("2019-11-14T18:10:38Z")).toBeNull();
  });
});

describe("isoFromMillis", () => {
  it("renders a count as UTC", () => {
    expect(isoFromMillis(1573755038314n)).toBe("2019-11-14T18:10:38.314Z");
  });

  it("is null past the range a Date can hold", () => {
    expect(isoFromMillis(8_640_000_000_000_001n)).toBeNull();
  });
});
