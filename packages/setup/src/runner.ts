/**
 * How the setup service runs a program: the one seam between an install and the machine.
 *
 * Every command an install needs -- `docker`, `winget`, `brew`, `sh` -- goes through a `Runner`
 * the caller hands in, so the decisions above it (is Docker ready, did the pull succeed) are
 * testable with a runner that answers from a table, and a GUI front end can hand in the same
 * process runner the terminal wizard uses.
 *
 * A program that is not installed is an ANSWER, not an exception: `processRunner` resolves exit
 * code 127, the code a shell gives "command not found". Asking "is Docker installed" is the
 * first thing an install does, and on most machines the honest answer is no; a thrown ENOENT
 * would make every caller write the same catch.
 */

import { spawn } from "node:child_process";

/** The exit code a shell gives a command it cannot find, and what a missing program answers. */
export const NOT_FOUND = 127;

export interface RunOptions {
  /** Each line the program writes to stdout or stderr, as it arrives -- a pull's progress. */
  readonly onLine?: (line: string) => void;
  /**
   * The program gets this terminal: its prompts, its colours, a `sudo` password, and Ctrl-C.
   * Nothing is captured, so `stdout` and `stderr` come back empty.
   */
  readonly interactive?: boolean;
}

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Runner = (
  command: string,
  args: readonly string[],
  options?: RunOptions,
) => Promise<RunResult>;

const LINE_BREAK = /\r?\n/u;

/** Split a stream into lines, holding the unfinished tail until the next chunk completes it. */
function lineSplitter(onLine: (line: string) => void): {
  push: (chunk: string) => void;
  end: () => void;
} {
  let pending = "";
  return {
    push: (chunk): void => {
      const lines = `${pending}${chunk}`.split(LINE_BREAK);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        onLine(line);
      }
    },
    end: (): void => {
      if (pending !== "") {
        onLine(pending);
      }
      pending = "";
    },
  };
}

/** Runs real programs on this machine. The composition root hands it in; nothing else builds one. */
export const processRunner: Runner = (command, args, options = {}) =>
  new Promise<RunResult>((resolve) => {
    const child = spawn(command, [...args], {
      stdio: options.interactive === true ? "inherit" : ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const onLine = options.onLine ?? ((): void => undefined);
    const out = lineSplitter(onLine);
    const err = lineSplitter(onLine);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      out.push(chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      err.push(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      resolve({
        code: error.code === "ENOENT" ? NOT_FOUND : 1,
        stdout,
        stderr: `${stderr}${error.message}`,
      });
    });
    child.on("close", (code) => {
      out.end();
      err.end();
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
