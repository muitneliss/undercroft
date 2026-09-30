/**
 * What `docker compose` prints, read into values: a step's outcome, and the services' states.
 */

import type { RunResult } from "./runner.ts";

/** A compose step's outcome. `tail` is the end of what it printed, for a person to read. */
export type StepResult = { readonly ok: true } | { readonly ok: false; readonly tail: string };

export interface ServiceStatus {
  readonly service: string;
  /** Docker's own word: `running`, `exited`, `restarting`, ... */
  readonly state: string;
  /** `healthy`, `unhealthy`, `starting`, or empty for a service with no healthcheck. */
  readonly health: string;
  readonly exitCode: number;
}

const TAIL_LINES = 20;
const LINE_BREAK = /\r?\n/u;

export function step(result: RunResult): StepResult {
  if (result.code === 0) {
    return { ok: true };
  }
  const printed = `${result.stdout}${result.stderr}`.trimEnd().split(LINE_BREAK);
  return { ok: false, tail: printed.slice(-TAIL_LINES).join("\n") };
}

function field(row: unknown, name: string): unknown {
  return typeof row === "object" && row !== null ? Reflect.get(row, name) : undefined;
}

function rowsOf(text: string): unknown[] {
  if (text.startsWith("[")) {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  }
  return text.split(LINE_BREAK).map((line): unknown => JSON.parse(line));
}

/**
 * `docker compose ps --format json`: one object per line on Compose v2.21 and later, one array
 * before it. `null` when it is neither, rather than a list that looks like "nothing running".
 */
export function parseStatus(stdout: string): ServiceStatus[] | null {
  const text = stdout.trim();
  if (text === "") {
    return [];
  }
  try {
    return rowsOf(text).map((row): ServiceStatus => {
      const exitCode = field(row, "ExitCode");
      return {
        service: String(field(row, "Service") ?? ""),
        state: String(field(row, "State") ?? ""),
        health: String(field(row, "Health") ?? ""),
        exitCode: typeof exitCode === "number" ? exitCode : 0,
      };
    });
  } catch {
    return null;
  }
}
