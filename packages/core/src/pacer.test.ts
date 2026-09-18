// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { describe, expect, test as it } from "bun:test";
import { TestClock } from "./clock.ts";
import { QuotaExhausted } from "./errors.ts";
import { createPacer } from "./pacer.ts";

describe("minimum interval", () => {
  it("lets the first request straight through", async () => {
    const pacer = createPacer({ minIntervalMs: 1100 }, new TestClock());
    await pacer.acquire();
    expect(pacer.granted).toBe(1);
  });

  it("holds the second request for the full interval", async () => {
    // Xero's 1.1 second spacing, proved in microseconds rather than in 1.1 seconds.
    const clock = new TestClock();
    const pacer = createPacer({ minIntervalMs: 1100 }, clock);
    await pacer.acquire();

    void pacer.acquire();
    await clock.advance(1099);
    expect(pacer.granted).toBe(1);

    await clock.advance(1);
    expect(pacer.granted).toBe(2);
  });

  it("serialises concurrent callers rather than letting them all decide at once", async () => {
    const clock = new TestClock();
    const pacer = createPacer({ minIntervalMs: 1000 }, clock);

    void pacer.acquire();
    void pacer.acquire();
    void pacer.acquire();
    await clock.advance(0);
    expect(pacer.granted).toBe(1);

    await clock.advance(1000);
    expect(pacer.granted).toBe(2);

    await clock.advance(1000);
    expect(pacer.granted).toBe(3);
  });
});

describe("requests per minute", () => {
  it("allows a full window without delay", async () => {
    const pacer = createPacer({ requestsPerMinute: 3 }, new TestClock());
    await pacer.acquire();
    await pacer.acquire();
    await pacer.acquire();
    expect(pacer.granted).toBe(3);
  });

  it("holds the next request until the window slides", async () => {
    const clock = new TestClock();
    const pacer = createPacer({ requestsPerMinute: 2 }, clock);
    await pacer.acquire();
    await pacer.acquire();

    void pacer.acquire();
    await clock.advance(59_999);
    expect(pacer.granted).toBe(2);

    await clock.advance(1);
    expect(pacer.granted).toBe(3);
  });
});

describe("the daily cap is not waited out", () => {
  it("throws rather than sleeping until tomorrow", async () => {
    // Sleeping would park a worker for hours while appearing to make progress.
    const clock = new TestClock();
    const pacer = createPacer({ requestsPerDay: 2 }, clock);
    await pacer.acquire();
    await pacer.acquire();
    expect(pacer.acquire()).rejects.toBeInstanceOf(QuotaExhausted);
  });

  it("lets requests through again once a day has passed", async () => {
    const clock = new TestClock();
    const pacer = createPacer({ requestsPerDay: 1 }, clock);
    await pacer.acquire();
    await expect(pacer.acquire()).rejects.toBeInstanceOf(QuotaExhausted);

    await clock.advance(86_400_000);
    await pacer.acquire();
    expect(pacer.granted).toBe(2);
  });

  it("an exhausted quota does not wedge later callers behind a rejected promise", async () => {
    const clock = new TestClock();
    const pacer = createPacer({ requestsPerDay: 1 }, clock);
    await pacer.acquire();
    await expect(pacer.acquire()).rejects.toBeInstanceOf(QuotaExhausted);
    await expect(pacer.acquire()).rejects.toBeInstanceOf(QuotaExhausted);
  });
});
