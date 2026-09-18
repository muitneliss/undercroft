// biome-ignore-all lint/style/noMagicNumbers: In a test the number IS the assertion. `expect(delayMs).toBe(5000)` says what the code must do; `expect(delayMs).toBe(EXPECTED_BACKOFF_MS)` says only that two names agree, and it can pass while both are wrong. Naming a fixture value also puts the expected result somewhere other than the line asserting it, which is the opposite of what .claude/rules/tests.md asks for. Source files get named constants; test files keep their literals.

// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { describe, expect, test as it } from "bun:test";
import { TestClock } from "./clock.ts";
import { createStampSource, formatStamp, isStamp, parseStamp } from "./stamp.ts";

describe("stamp format", () => {
  it("has microsecond precision, not millisecond", () => {
    const stamp = formatStamp(Date.UTC(2026, 8, 17, 10, 15, 1) * 1000 + 4213);
    expect(stamp).toBe("20260917T101501.004213Z");
  });

  it("recognises its own shape and rejects a millisecond one", () => {
    expect(isStamp("20260917T101501.004213Z")).toBe(true);
    // Three digits would be a Date-shaped stamp: the exact mistake that
    // reintroduces the collision microseconds were adopted to fix.
    expect(isStamp("20260917T101501.004Z")).toBe(false);
    expect(isStamp("not-a-stamp")).toBe(false);
  });

  it("round-trips through parse", () => {
    const micros = Date.UTC(2026, 8, 17, 10, 15, 1) * 1000 + 4213;
    expect(parseStamp(formatStamp(micros))).toBe(micros);
  });

  it("sorts lexically in the same order as chronologically", () => {
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
  it("advances even when the clock has not moved", () => {
    const clock = new TestClock();
    const stamps = createStampSource(clock);
    const first = stamps.next();
    const second = stamps.next();
    expect(second).not.toBe(first);
    expect(second > first).toBe(true);
  });

  it("100,000 stamps in a tight loop are all distinct and ascending", () => {
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

  it("follows the clock forward when it does move", async () => {
    const clock = new TestClock();
    const stamps = createStampSource(clock);
    const before = stamps.next();
    await clock.advance(1000);
    const after = stamps.next();
    expect(parseStamp(after)! - parseStamp(before)!).toBeGreaterThanOrEqual(1_000_000);
  });
});
