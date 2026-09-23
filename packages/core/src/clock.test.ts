import { describe, expect, test as it } from "bun:test";
import { TestClock } from "./clock.ts";

describe("TestClock", () => {
  it("a sleeper stays parked until the clock passes its deadline", async () => {
    // Every pacing and backoff test in the repo reads its answer off this boundary: a clock
    // that woke a sleeper a millisecond early, or never, would let each of them pass without
    // proving the spacing it claims to pin.
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
});
