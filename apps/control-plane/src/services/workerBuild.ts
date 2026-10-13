/**
 * A build, asked of the worker (issue 442): `workerClient.ts`'s one verb with three answers --
 * built and waited for, started and not, or refused because a build already holds the tenant's
 * lock, naming it -- in a module of its own so those are read in one place.
 *
 * The worker and the control plane deploy separately, so the request also speaks to a worker
 * older than `select` (`BuildModelRequest`), and the answer is parsed rather than cast, so one
 * from that worker reads as what it is.
 */

import { BuildModelResponse, BuildStarted } from "@undercroft/contracts";
import { ACCEPTED, CONFLICT, OK, REFUSAL_BY_STATUS, type WorkerFailure } from "./workerRefusals.ts";
import { type Envelope, envelopeOf, exchange, type WorkerTransport } from "./workerTransport.ts";

/**
 * How long a build that is waited for may take: the worker's two-minute deadline, and a little
 * for the steps, the counts and the rows. Exported because `models.build` holds its request
 * open this long (ADR 0125).
 */
export const BUILD_DEADLINE_MS = 150_000;

/** What a build was asked: some models, as dbt selectors, waited for or not (issue 442). */
export interface BuildInput {
  readonly tenantId: string;
  /** `ModelSelector`s: `name`, `+name` (and upstream), `name+` (and downstream). */
  readonly select: readonly string[];
  /** `false` answers with the run as soon as it is open, and the build goes on. */
  readonly wait: boolean;
  /** An `app_user` uuid, never an address. */
  readonly triggeredBy: string;
}

/** What a build answered: everything it did, once waited for, or only its run, when not. */
export type BuildAnswer =
  | ({ readonly waited: true } & BuildModelResponse)
  | { readonly waited: false; readonly runId: string };

/**
 * A build's answers. Its refusal for a build already running names that run, as a trigger's
 * does: who asked can wait on it instead of retrying blind (issue 442).
 */
export type BuildOutcome =
  | { readonly ok: true; readonly value: BuildAnswer }
  | { readonly ok: false; readonly reason: "in-progress"; readonly runId: string }
  | { readonly ok: false; readonly reason: Exclude<WorkerFailure, "in-progress"> };

/**
 * A build: the fourth call whose refusal body IS read, because its 409 `run_in_progress` names
 * the run holding the tenant's build lock in `details` -- a run id, never a token.
 */
export function buildOn(t: WorkerTransport): (input: BuildInput) => Promise<BuildOutcome> {
  return (input) =>
    exchange(
      t,
      { path: "/v1/models/build", body: bodyOf(input), deadlineMs: BUILD_DEADLINE_MS },
      answerOf,
    );
}

/**
 * The request, with `model` beside `select` when the selection is one plain model: what a worker
 * older than `select` can build too (`BuildModelRequest`). One of several, or one with a `+`, it
 * refuses rather than narrows.
 */
function bodyOf(input: BuildInput): BuildInput & { model?: string } {
  const [only, ...rest] = input.select;
  const legacy = only !== undefined && rest.length === 0 && !only.includes("+");
  return legacy ? { ...input, model: only } : input;
}

/**
 * 200 is a build waited for, 202 one that was not; each body is parsed rather than cast, so
 * `rowCounts` from a worker older than it reads as none counted. Any other 2xx is not an answer
 * this call knows.
 */
async function answerOf(response: Response): Promise<BuildOutcome> {
  if (response.status === CONFLICT) {
    return buildRefusalOf(await envelopeOf(response));
  }
  if (response.status === ACCEPTED) {
    const started = BuildStarted.safeParse(await response.json());
    return started.success
      ? { ok: true, value: { waited: false, runId: started.data.runId } }
      : { ok: false, reason: "refused" };
  }
  if (response.status !== OK) {
    // A 409 was read above, so no status left here names a build in progress.
    const reason = REFUSAL_BY_STATUS.get(response.status) ?? "refused";
    return { ok: false, reason: reason === "in-progress" ? "refused" : reason };
  }
  const built = BuildModelResponse.safeParse(await response.json());
  return built.success
    ? { ok: true, value: { waited: true, ...built.data } }
    : { ok: false, reason: "refused" };
}

/**
 * A build's 409, read from its envelope. `run_in_progress` names the holder; any other 409 --
 * a customer deactivated between the router's check and the worker's (ADR 0110) -- is a plain
 * refusal, not a build to wait for.
 */
function buildRefusalOf(refusal: Envelope): BuildOutcome {
  if (refusal?.code === "run_in_progress") {
    const details = Array.isArray(refusal.details) ? refusal.details : [];
    return { ok: false, reason: "in-progress", runId: String(details[0] ?? "") };
  }
  return { ok: false, reason: "refused" };
}
