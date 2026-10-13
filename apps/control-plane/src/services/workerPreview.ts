/**
 * A model preview, asked of the worker (ADR 0132): `workerClient.ts`'s one verb with two refusals
 * whose body IS read, in a module of its own so both are read in one place, as a build's are in
 * `workerBuild.ts`.
 *
 * Its 400 names which of the author's texts was refused: `compile_failed` carries dbt's account
 * of why the model would not compile, `query_failed` Postgres's sentence about the SQL dbt
 * compiled or the outer query over it. Each quotes the author's own text and no row -- compiling
 * reads none, and Postgres quotes the statement -- and each is what lets them fix it.
 */

import { ModelPreview, type PreviewModelRequest } from "@undercroft/contracts";
import { BAD_REQUEST, REFUSAL_BY_STATUS } from "./workerRefusals.ts";
import type { WorkerOutcome } from "./workerClient.ts";
import { envelopeOf, exchange, type WorkerTransport } from "./workerTransport.ts";

/**
 * How long a preview may take: the worker's ninety seconds -- ten for a turn, sixty to compile,
 * fifteen for the query, five around them -- and a little for the answer to arrive. Exported
 * because `models.preview` holds its request open this long (ADR 0124).
 */
export const PREVIEW_DEADLINE_MS = 95_000;

/** The worker's refusal codes the preview reads, and the failure each is to its caller. */
const AUTHOR_REFUSALS: ReadonlyMap<unknown, "compile-failed" | "query-failed"> = new Map([
  ["compile_failed", "compile-failed"],
  ["query_failed", "query-failed"],
]);

export function previewOn(
  t: WorkerTransport,
): (input: PreviewModelRequest) => Promise<WorkerOutcome<ModelPreview>> {
  return (input) =>
    exchange(
      t,
      { path: "/v1/models/preview", body: input, deadlineMs: PREVIEW_DEADLINE_MS },
      async (response): Promise<WorkerOutcome<ModelPreview>> => {
        if (response.status === BAD_REQUEST) {
          const refusal = await envelopeOf(response);
          const reason = AUTHOR_REFUSALS.get(refusal?.code);
          return reason !== undefined && typeof refusal?.message === "string"
            ? { ok: false, reason, message: refusal.message }
            : { ok: false, reason: "refused" };
        }
        if (!response.ok) {
          return { ok: false, reason: REFUSAL_BY_STATUS.get(response.status) ?? "refused" };
        }
        const parsed = ModelPreview.safeParse(await response.json());
        return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: "refused" };
      },
    );
}
