// biome-ignore-all lint/style/noMagicNumbers: In a test the number IS the assertion. `expect(delayMs).toBe(5000)` says what the code must do; `expect(delayMs).toBe(EXPECTED_BACKOFF_MS)` says only that two names agree, and it can pass while both are wrong. Naming a fixture value also puts the expected result somewhere other than the line asserting it, which is the opposite of what .claude/rules/tests.md asks for. Source files get named constants; test files keep their literals.

// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { describe, expect, test as it } from "bun:test";
import { TestClock } from "./clock.ts";

describe("TestClock", () => {
  it("does not move on its own", async () => {
    const clock = new TestClock();
    const before = clock.now().toISOString();
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    expect(clock.now().toISOString()).toBe(before);
  });

  it("a sleeper stays parked until the clock passes its deadline", async () => {
    const clock = new TestClock();
    let woke = false;
    void clock.sleep(1100).then(() => {
      woke = true;
    });

    await clock.advance(1099);
    expect(woke).toBe(false);

    await clock.advance(1);
    expect(woke).toBe(true);
  });

  it("a zero sleep resolves without parking", async () => {
    const clock = new TestClock();
    await clock.sleep(0);
    expect(clock.sleeping).toBe(0);
  });
});
