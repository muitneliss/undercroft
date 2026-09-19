/**
 * Reports, as the control plane serves them: SQL an author wrote, run through the worker
 * as the tenant's read-only login, and the schema that SQL can name.
 *
 * Nothing here touches the database. The control plane holds no tenant login and cannot
 * mint one (ADR 0016, extended to data): it asks the worker, which can, and relays rows.
 * A query is not audited -- a read is not a change -- and a refusal is returned as a value
 * for the handler to word.
 */

import type { RunQueryRequest, SchemaResponse, TableResult } from "@undercroft/contracts";

import type { WorkerClient, WorkerOutcome } from "./workerClient.ts";

export function run(
  worker: WorkerClient,
  input: RunQueryRequest,
): Promise<WorkerOutcome<TableResult>> {
  return worker.runQuery(input);
}

export function schema(
  worker: WorkerClient,
  input: { tenantId: string },
): Promise<WorkerOutcome<SchemaResponse>> {
  return worker.readSchema(input);
}
