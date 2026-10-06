/**
 * An export, asked of the worker (ADR 0111): `workerClient.ts`'s one verb whose answer is a
 * stream rather than a JSON document, in a module of its own so that difference is read once.
 *
 * Its refusals are `queryOn`'s: a 400 `query_failed` carries Postgres's sentence about the
 * author's SQL, which quotes their own text and nothing else, and every other status is read
 * from the status alone. On success the body is handed on unread, for the control plane to pass
 * to the person as it arrives.
 */

import type { ExportQueryRequest } from "@undercroft/contracts";
import type { WorkerClient, WorkerOutcome } from "./workerClient.ts";
import { BAD_REQUEST, REFUSAL_BY_STATUS } from "./workerRefusals.ts";
import { envelopeOf, exchange, type WorkerTransport } from "./workerTransport.ts";

/**
 * How long the first byte may take: the worker's two minutes for one FETCH, its ten seconds for
 * a turn, and a little more. `exchange` clears its timer once the answer has started, so this
 * bounds only the wait; the rows after it are bounded by the worker's own deadline, which cuts
 * the stream rather than ending it.
 */
const FIRST_BYTE_MS = 150_000;

export function exportOn(t: WorkerTransport): WorkerClient["exportQuery"] {
  return (input: ExportQueryRequest) =>
    exchange(
      t,
      { path: "/v1/queries/export", body: input, deadlineMs: FIRST_BYTE_MS },
      async (response): Promise<WorkerOutcome<ReadableStream<Uint8Array>>> => {
        if (response.status === BAD_REQUEST) {
          const refusal = await envelopeOf(response);
          return refusal?.code === "query_failed" && typeof refusal.message === "string"
            ? { ok: false, reason: "query-failed", message: refusal.message }
            : { ok: false, reason: "refused" };
        }
        if (!response.ok || response.body === null) {
          return { ok: false, reason: REFUSAL_BY_STATUS.get(response.status) ?? "refused" };
        }
        return { ok: true, value: response.body };
      },
    );
}
