/**
 * Every program this app starts, so that quitting the app can stop them (ADR 0098).
 *
 * The app's work is other programs: `docker compose` pulling and starting the stack, `docker`
 * answering whether it is ready, `winget` installing Docker. Electrobun ends the app's own
 * process when it quits, and nothing more; a compose pull it had started would carry on with no
 * one to read it, and die at its next line of output on a pipe nobody holds. So `main.ts` gives
 * both services `run` from here rather than the bare runner, and a quit first `stop`s what is
 * running: each program is asked to end, and compose cancels cleanly (on Windows, which cannot
 * ask, it is ended with its children; `@undercroft/setup`'s `processRunner`), and the quit goes
 * ahead once every one has exited.
 *
 * Stopping a step does not lose an install. The install folder is written before the first
 * pull, so the next Start finds it and runs the step again, and Docker keeps the layers a
 * stopped pull already had. Stopping does not refuse later runs either: `main.ts` asks whether
 * anything is running on every quit request, so one started in the meantime is stopped too.
 */

import type { RunOptions, RunResult, Runner } from "@undercroft/setup";

export interface Processes {
  /** Runs a program as `run` would, and stops it when `stop` is called. */
  readonly run: Runner;
  /** Whether a program started here is still running. */
  running: () => boolean;
  /** Stop every program running now; resolves once each has exited. */
  stop: () => Promise<void>;
}

class ProcessGroup implements Processes {
  readonly #run: Runner;
  /** Each running program's stop, and its run -- which settles only after it is forgotten here. */
  readonly #live = new Map<AbortController, Promise<RunResult>>();

  constructor(run: Runner) {
    this.#run = run;
  }

  readonly run: Runner = (command, args, options: RunOptions = {}) => {
    const stop = new AbortController();
    const exited = this.#run(command, args, { ...options, signal: stop.signal }).finally(() => {
      this.#live.delete(stop);
    });
    this.#live.set(stop, exited);
    return exited;
  };

  readonly running = (): boolean => this.#live.size > 0;

  readonly stop = async (): Promise<void> => {
    const stopping = [...this.#live];
    for (const [stop] of stopping) {
      stop.abort();
    }
    // Settled rather than all fulfilled: a run that rejected has ended too.
    await Promise.allSettled(stopping.map(([, exited]) => exited));
  };
}

export function processGroup(run: Runner): Processes {
  return new ProcessGroup(run);
}
