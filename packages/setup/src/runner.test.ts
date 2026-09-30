import { describe, expect, it } from "bun:test";
import { processRunner, STOP_GRACE_MS } from "./runner.ts";

/** Real programs, stopped the way the desktop app stops them when it quits. */
describe("processRunner's signal", () => {
  it("leaves a program it is never asked to stop to finish", async () => {
    const result = await processRunner("sh", ["-c", "exit 3"], {
      signal: new AbortController().signal,
    });
    expect(result.code).toBe(3);
  });

  it("asks a running program to end, and resolves once it has", async () => {
    const stop = new AbortController();
    const started = Date.now();
    const run = processRunner("sleep", ["30"], { signal: stop.signal });
    stop.abort();
    const result = await run;
    expect(result.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(STOP_GRACE_MS);
  });

  it(
    "kills a program that ignores the request once the grace period is over",
    async () => {
      const stop = new AbortController();
      const { promise: trapped, resolve } = Promise.withResolvers<void>();
      // `exec` hands the ignored SIGTERM on to `sleep`, so nothing is left holding the pipe.
      const run = processRunner("sh", ["-c", "trap '' TERM; echo trapped; exec sleep 30"], {
        signal: stop.signal,
        onLine: () => resolve(),
      });
      // Asked before the trap is set, `sh` would simply end, and the test would prove nothing.
      await trapped;
      const asked = Date.now();
      stop.abort();
      const result = await run;
      expect(result.code).not.toBe(0);
      expect(Date.now() - asked).toBeGreaterThanOrEqual(STOP_GRACE_MS);
    },
    STOP_GRACE_MS * 3,
  );
});
