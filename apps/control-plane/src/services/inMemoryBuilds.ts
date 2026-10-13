/**
 * The worker's build, in memory: what `InMemoryWorkerClient` answers a build it does not refuse
 * with. Its own module because the build is the one verb of that double with an answer worth
 * setting -- steps, counts, a preview -- and the double had no room left for it.
 *
 * Whether the worker refuses (a build already running, a worker down) stays with the double,
 * which decides it for every verb alike. What dbt builds and counts is not modelled here: it is
 * proven against a real catalogue, with the worker's fake dbt, in
 * `apps/worker/src/handlers/models.test.ts`.
 */

import type { BuildModelResponse } from "@undercroft/contracts";
import type { BuildInput, BuildOutcome } from "./workerClient.ts";

type WaitedAnswer = Omit<BuildModelResponse, "runId">;

export class InMemoryBuilds {
  /** Every build this double ran, in order. */
  readonly asked: BuildInput[] = [];
  /** A success with nothing to show, until `answering` says otherwise. */
  #answer: WaitedAnswer = {
    ok: true,
    testsFailed: 0,
    error: null,
    steps: [],
    rowCounts: [],
    preview: null,
  };

  /** What every waited build answers, but its run id, which is numbered per build. */
  answering(answer: WaitedAnswer): this {
    this.#answer = answer;
    return this;
  }

  /** Run one build: with `wait: false`, only its run, as the worker's 202 answers. */
  run(input: BuildInput): BuildOutcome {
    this.asked.push(input);
    const runId = `run-mem-build-${String(this.asked.length)}`;
    return {
      ok: true,
      value: input.wait ? { waited: true, runId, ...this.#answer } : { waited: false, runId },
    };
  }
}
