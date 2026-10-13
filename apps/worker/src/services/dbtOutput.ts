/**
 * What dbt said about why a build is not ok, read out of its output and its steps: the cause it
 * stopped on, the last lines it wrote, and the model or seed that broke.
 *
 * Apart from `transform.ts`, which runs the build, because these read dbt's own words and
 * nothing else; a change to how dbt words a failure is a change here alone.
 */

import type { RunStep } from "@undercroft/db/repos";

/** How many trailing lines of dbt's output are kept. Enough to name the fault; never a row. */
const TAIL_LINES = 20;

/** The line dbt opens its own account of an error it stopped on with. */
const ENCOUNTERED = "Encountered an error";
/** The `HH:MM:SS  ` dbt writes in front of each line it logs. */
const LOG_TIME = /^\d{2}:\d{2}:\d{2}\s+/u;

export function tailOf(output: string): string {
  return output.trim().split("\n").slice(-TAIL_LINES).join("\n");
}

/**
 * Why dbt stopped before its first model, in its own words: its "Encountered an error:" line
 * and everything after it, else its last lines.
 *
 * NOT THE TAIL (issue #336). A run keeps the first 500 characters of its error, and when dbt
 * stops early its last lines are mostly its startup banner -- which took all 500 and cut the
 * cause off at the "E" of "Encountered". Starting at that line puts the cause first, so the
 * bound, when it bites, keeps the cause's opening words and drops the banner instead. The
 * time dbt stamps on each line is dropped for the same reason: it is not the cause.
 */
export function causeOf(output: string): string {
  const lines = output.trim().split("\n");
  const at = lines.findIndex((line) => line.replace(LOG_TIME, "").startsWith(ENCOUNTERED));
  if (at === -1) {
    return tailOf(output);
  }
  return lines
    .slice(at)
    .map((line) => line.replace(LOG_TIME, "").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Why the build is not ok, in dbt's own words for the model or seed that broke: a seed that did
 * not load left its readers skipped, or reading whatever the last load left (ADR 0128).
 */
export function errorOf(steps: readonly RunStep[], tail: string): string | null {
  const broken = steps.find((s) => s.kind !== "test" && s.status === "error");
  if (broken === undefined) {
    return null;
  }
  return broken.message ?? tail;
}
