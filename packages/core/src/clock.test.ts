// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { describe, expect, test } from "bun:test";
import { TestClock } from "./clock.ts";

describe("TestClock", () => {
  test("does not move on its own", async () => {
    const clock = new TestClock();
    const before = clock.now().toISOString();
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    expect(clock.now().toISOString()).toBe(before);
  });

  test("a sleeper stays parked until the clock passes its deadline", async () => {
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

  test("a zero sleep resolves without parking", async () => {
    const clock = new TestClock();
    await clock.sleep(0);
    expect(clock.sleeping).toBe(0);
  });
});
