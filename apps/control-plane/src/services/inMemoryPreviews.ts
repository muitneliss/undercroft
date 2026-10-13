/**
 * The worker's model preview, in memory (ADR 0132): what `InMemoryWorkerClient` answers a preview
 * it does not refuse for every verb alike. Its own module for the reason `inMemoryBuilds.ts` has
 * one: the preview has answers worth setting -- rows, or dbt's refusal -- and the double had no
 * room left for them.
 *
 * It refuses what it was not set up for: with no `answering`, a preview is `refused`, so a flow
 * that previews by accident fails loudly. Like the raw console, it models the CALLER's decisions
 * -- who is admitted, what a refusal becomes on screen. What the worker compiles and which login
 * runs it are proven against PGlite, with the worker's fake dbt, in
 * `apps/worker/src/services/modelPreview.test.ts`.
 */

import type { ModelPreview, PreviewModelRequest } from "@undercroft/contracts";
import type { WorkerOutcome } from "./workerClient.ts";
import type { WorkerFailure } from "./workerRefusals.ts";

export class InMemoryPreviews {
  /** Every preview this double was asked for, in order. */
  readonly asked: PreviewModelRequest[] = [];
  #answer: ModelPreview | null = null;
  #compileRefusal: string | null = null;

  /** What every preview answers. Unset, a preview is refused: it was not set up. */
  answering(answer: ModelPreview): this {
    this.#answer = answer;
    return this;
  }

  /** Refuse every preview with dbt's account of why, as the worker does for a bad model. */
  refusingCompile(cause: string): this {
    this.#compileRefusal = cause;
    return this;
  }

  /**
   * One preview: refused, unasked, as the double refuses every call (`failWith`); else refused as
   * dbt refuses a model that will not compile, or as Postgres refuses SQL when the double refuses
   * every query (`queryRefusal`); else answered as `answering` says.
   */
  run(
    input: PreviewModelRequest,
    failWith: WorkerFailure | null,
    queryRefusal: string | null,
  ): Promise<WorkerOutcome<ModelPreview>> {
    return Promise.resolve(this.#outcome(input, failWith, queryRefusal));
  }

  #outcome(
    input: PreviewModelRequest,
    failWith: WorkerFailure | null,
    queryRefusal: string | null,
  ): WorkerOutcome<ModelPreview> {
    if (failWith !== null) {
      return { ok: false, reason: failWith };
    }
    this.asked.push(input);
    if (this.#compileRefusal !== null) {
      return { ok: false, reason: "compile-failed", message: this.#compileRefusal };
    }
    if (queryRefusal !== null) {
      return { ok: false, reason: "query-failed", message: queryRefusal };
    }
    return this.#answer === null
      ? { ok: false, reason: "refused" }
      : { ok: true, value: this.#answer };
  }
}
