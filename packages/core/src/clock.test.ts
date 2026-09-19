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
