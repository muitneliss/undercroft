/**
 * A step that takes a while, shown the way the terminal can show it.
 *
 * At a terminal it is Clack's spinner, its message following the latest line Docker printed.
 * Without one -- `--yes` in a script, a CI log, `install.sh` piped nowhere -- a spinner writes a
 * frame per tick into the log, hundreds of lines of it, so the step is a line when it starts
 * and a line when it ends, and Docker's own lines are left out.
 */

import { log, spinner } from "@clack/prompts";
import type { Context } from "./context.ts";

export interface Progress {
  start: (message: string) => void;
  message: (message: string) => void;
  stop: (message: string) => void;
  error: (message: string) => void;
  clear: () => void;
}

const QUIET: Omit<Progress, "start" | "stop" | "error"> = {
  message: (): void => undefined,
  clear: (): void => undefined,
};

export function progress(ctx: Context): Progress {
  if (ctx.interactive) {
    return spinner();
  }
  return {
    ...QUIET,
    start: (message): void => log.step(message),
    stop: (message): void => log.success(message),
    error: (message): void => log.error(message),
  };
}
