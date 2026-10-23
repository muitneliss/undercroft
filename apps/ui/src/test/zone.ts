/**
 * Puts the process on one zone's clock, for a suite that asserts a rendered time or day.
 *
 * The UI prints every instant in the viewer's own zone (ADR 0149), which in a test is the
 * runtime's: UTC under `bun test`, the laptop's own zone when a person runs a file by other
 * means. A suite that asserts "00:30" without choosing a zone passes on one machine and fails on
 * the next, or passes on both for the wrong reason. `TZ` is how a JavaScript runtime is told its
 * zone, and Bun reads it again when it changes.
 *
 * A suite writes `beforeAll(() => enterZone(VIETNAM))` and `afterAll(leaveZone)`. The zone it
 * replaced is given back, because a worker process runs several files in turn and the next one
 * must not inherit this one's clock. A stack, so a `describe` may move to a second zone inside a
 * file that set a first.
 */

import process from "node:process";

/** The `TZ` each `enterZone` replaced, `undefined` where none was set. */
const replaced: (string | undefined)[] = [];

export function enterZone(zone: string): void {
  replaced.push(process.env.TZ);
  process.env.TZ = zone;
}

export function leaveZone(): void {
  const was = replaced.pop();
  if (was === undefined) {
    Reflect.deleteProperty(process.env, "TZ");
  } else {
    process.env.TZ = was;
  }
}

/** UTC+7 all year: an hour behind Singapore, which is what tells the two zones apart. */
export const VIETNAM = "Asia/Ho_Chi_Minh";

/** UTC+8 all year, with no daylight saving. */
export const SINGAPORE = "Asia/Singapore";
