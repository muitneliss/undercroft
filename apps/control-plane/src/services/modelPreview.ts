/**
 * What an unsaved model returns (ADR 0132): the decision behind `models.preview`.
 *
 * The worker does all of it -- compiles the draft in the tenant's own project, with no
 * credential, and runs what dbt compiled in the read-only frame as the tenant's dbt login --
 * because the worker is the one process that can become a tenant's login (ADR 0016). Nothing is
 * stored here and nothing is built: the saved models, the run ledger and the tables are exactly
 * as they were. Today this only asks; it is the seam where a rule about previews would go, and
 * what lets a job or the CLI's server side call the same decision without the router.
 */

import type { ModelPreview, PreviewModelRequest } from "@undercroft/contracts";
import type { WorkerClient, WorkerOutcome } from "./workerClient.ts";

/**
 * The preview's rows and compiled SQL, or why not: `compile-failed` with dbt's cause,
 * `query-failed` with Postgres's sentence, or the worker's other refusals.
 */
export function preview(
  worker: WorkerClient,
  input: PreviewModelRequest,
): Promise<WorkerOutcome<ModelPreview>> {
  return worker.previewModel(input);
}
