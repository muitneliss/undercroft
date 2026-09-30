/**
 * Real in-memory stand-ins for the machine an install runs on, for this package's suites and
 * for any front end's.
 *
 * `tableRunner` answers a command from a table and REFUSES one the table does not model, the
 * way `InMemoryFetcher` refuses an unmodelled request: a runner that answered everything with
 * exit 0 would make a broken sequence of Docker calls look like a working one
 * (`.claude/rules/tests.md`).
 */

import type { Clock } from "@undercroft/core";
import type { RunResult, Runner } from "./runner.ts";

/** A command line as the table keys it: the program and its arguments, space-separated. */
export function commandLine(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
}

export function tableRunner(table: Readonly<Record<string, Partial<RunResult>>>): Runner {
  return (command, args, options) => {
    const line = commandLine(command, args);
    const answer = table[line];
    if (answer === undefined) {
      return Promise.reject(new Error(`tableRunner: no answer modelled for \`${line}\``));
    }
    const result = { code: 0, stdout: "", stderr: "", ...answer };
    for (const text of `${result.stdout}${result.stderr}`.split("\n").filter(Boolean)) {
      options?.onLine?.(text);
    }
    return Promise.resolve(result);
  };
}

/**
 * A clock whose `sleep` moves time forward and returns at once, so a poll with a deadline runs
 * to its end in microseconds and a test never waits on a real timer.
 */
export function steppingClock(start = new Date("2026-01-01T00:00:00.000Z")): Clock {
  let nowMs = start.getTime();
  return {
    now: (): Date => new Date(nowMs),
    sleep: (ms): Promise<void> => {
      nowMs += Math.max(0, ms);
      return Promise.resolve();
    },
  };
}
