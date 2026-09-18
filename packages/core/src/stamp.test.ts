import { describe, expect, test } from "bun:test";
import { TestClock } from "./clock.ts";
import { createStampSource, formatStamp, isStamp, parseStamp } from "./stamp.ts";

describe("stamp format", () => {
  test("has microsecond precision, not millisecond", () => {
    const stamp = formatStamp(Date.UTC(2026, 8, 17, 10, 15, 1) * 1000 + 4213);
    expect(stamp).toBe("20260917T101501.004213Z");
  });

  test("recognises its own shape and rejects a millisecond one", () => {
    expect(isStamp("20260917T101501.004213Z")).toBe(true);
    // Three digits would be a Date-shaped stamp: the exact mistake that
    // reintroduces the collision microseconds were adopted to fix.
    expect(isStamp("20260917T101501.004Z")).toBe(false);
    expect(isStamp("not-a-stamp")).toBe(false);
  });

  test("round-trips through parse", () => {
    const micros = Date.UTC(2026, 8, 17, 10, 15, 1) * 1000 + 4213;
    expect(parseStamp(formatStamp(micros))).toBe(micros);
  });

  test("sorts lexically in the same order as chronologically", () => {
    // The loader pages the journal with a plain `StartAfter`, so this is not a
    // nicety -- it is what makes incremental load correct.
    const base = Date.UTC(2026, 8, 17, 10, 15, 1) * 1000;
    const stamps = [base + 5, base, base + 1_000_000, base + 999_999].map(formatStamp);
    expect([...stamps].sort()).toEqual(
      [base, base + 5, base + 999_999, base + 1_000_000].map(formatStamp),
    );
  });
});

describe("StampSource is strictly monotonic", () => {
  test("advances even when the clock has not moved", () => {
    const clock = new TestClock();
    const stamps = createStampSource(clock);
    const first = stamps.next();
    const second = stamps.next();
    expect(second).not.toBe(first);
    expect(second > first).toBe(true);
  });

  test("100,000 stamps in a tight loop are all distinct and ascending", () => {
    // The test that would have caught a `Date`-based implementation: with
    // millisecond resolution this loop produces thousands of duplicates, and a
    // create-only store rejects real data on the second of each pair.
    const stamps = createStampSource(new TestClock());
    let previous = "";
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) {
      const stamp = stamps.next();
      expect(stamp > previous).toBe(true);
      previous = stamp;
      seen.add(stamp);
    }
    expect(seen.size).toBe(100_000);
  });

  test("follows the clock forward when it does move", async () => {
    const clock = new TestClock();
    const stamps = createStampSource(clock);
    const before = stamps.next();
    await clock.advance(1000);
    const after = stamps.next();
    expect(parseStamp(after)! - parseStamp(before)!).toBeGreaterThanOrEqual(1_000_000);
  });
});
