/**
 * Every row one SELECT answers, as a CSV stream, read as the tenant's BI login (ADR 0111).
 *
 * The same login and the same frame as `runQuery` -- read-only, the tenant's own search path, a
 * statement timeout -- with a cursor in place of the LIMIT, so an export of any length is one
 * snapshot fetched a batch at a time, each batch encoded by the CSV encoder the browser's
 * download uses (`@undercroft/contracts/csv`).
 *
 * WHAT THE CALLER IS GIVEN. A promise that settles once the first batch is in: the stream, or a
 * refusal -- `QueryFailed` with Postgres's sentence, `TenantBusy`, `TenantNotProvisioned`. Every
 * refusal a request can earn arrives before the first byte, as a status the control plane words.
 *
 * WHAT A BROKEN EXPORT LOOKS LIKE. Whatever fails after the first byte -- a division by zero at
 * row 40,000, the deadline, the worker stopping -- ERRORS the stream rather than closing it. A
 * closed stream is a complete file. An errored one reaches the client as a body cut short, which
 * every HTTP client reports as a failed download. A short file that ended cleanly would read as
 * the whole answer, and that is the one outcome this must never produce.
 *
 * WHAT IT HOLDS. One of the tenant login's pooled connections and an open transaction, for as
 * long as the reader takes. So it takes a turn (`turns.export`), keeps it to the last batch, and
 * gives up at `EXPORT_DEADLINE_MS`. The stream pulls: a slow reader slows the fetching rather
 * than filling memory, and a reader that goes away ends the transaction at the next batch.
 */

import {
  CSV_BOM,
  csvHeader,
  csvRows,
  type ExportQueryRequest,
  type QueryScope,
  type TableResult,
} from "@undercroft/contracts";
import { describeError, type Logger, UndercroftError } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { tenantRolesFor } from "@undercroft/db/repos";

import {
  type Framed,
  fetchExportRows,
  inReadOnlyTransaction,
  openExportCursor,
  typeNames,
} from "../repos/queries.ts";
import { cellOf } from "./preview.ts";
import { type QueryDeps, queryFailedBy } from "./queryRunner.ts";
import { NotStarted, type RunTurns, turnsFor } from "./slots.ts";
import { TenantBusy } from "./tenantBusy.ts";
import { TenantNotProvisioned } from "./tenantSession.ts";

/** How long one FETCH may run: the first computes a sort or an aggregate in full. */
export const EXPORT_STATEMENT_TIMEOUT_MS = 120_000;
/** The longest an export may take end to end, whatever the reader's pace. */
export const EXPORT_DEADLINE_MS = 10 * 60_000;
/** How long an export waits for a turn before it is told the worker is busy. */
const TURN_WAIT_MS = 10_000;
/** Rows per FETCH: a batch's CSV is a few hundred kilobytes, never the whole answer. */
const BATCH_ROWS = 1000;

const UTF8 = new TextEncoder();

/**
 * Why an export stopped after its first byte without the database refusing anything: its
 * deadline passed, or the worker is stopping. The stream errors with it, so the file fails.
 */
export class ExportCut extends UndercroftError {}

export interface ExportDeps extends QueryDeps {
  /** How many exports run at once; `turns.export`, or no limit when the process set none. */
  readonly turns?: RunTurns;
  /** Aborted when the worker is stopping; an export in flight is then cut, never finished short. */
  readonly stop?: AbortSignal;
  /**
   * Where an export cut after its first byte is recorded. Its caller has a 200 by then and can
   * be told only by the cut, so this line is the one place the reason is kept.
   */
  readonly log?: Logger;
}

/** Where the rows go, and what to do the moment the first of them is ready. */
interface Sink {
  readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  readonly begin: () => void;
}

/** The next batch; a failure of it is the author's query failing, as at the first. */
async function nextBatch(exec: SqlExecutor): Promise<Framed> {
  try {
    return await fetchExportRows(exec, BATCH_ROWS);
  } catch (error) {
    throw queryFailedBy(error);
  }
}

/** The columns a batch carries, typed by Postgres's own names for them. */
async function columnsOf(exec: SqlExecutor, batch: Framed): Promise<TableResult["columns"]> {
  const names = await typeNames(
    exec,
    batch.fields.map((f) => f.dataTypeID),
  );
  return batch.fields.map((f) => ({
    name: f.name,
    type: names.get(f.dataTypeID) ?? String(f.dataTypeID),
  }));
}

function stillAllowed(deps: ExportDeps, deadline: number): void {
  if (deps.stop?.aborted === true) {
    throw new ExportCut("the worker stopped before the export finished");
  }
  if (Date.now() > deadline) {
    throw new ExportCut(`the export ran past its ${String(EXPORT_DEADLINE_MS / 60_000)} minutes`);
  }
}

/** Inside the frame: open the cursor, then write the header and every batch to the sink. */
async function writeRows(
  deps: ExportDeps,
  exec: SqlExecutor,
  sql: string,
  sink: Sink,
): Promise<void> {
  const deadline = Date.now() + EXPORT_DEADLINE_MS;
  try {
    await openExportCursor(exec, sql);
  } catch (error) {
    throw queryFailedBy(error);
  }
  let batch = await nextBatch(exec);
  const columns = await columnsOf(exec, batch);
  const lines = csvRows(columns);
  sink.begin();
  await sink.writer.write(UTF8.encode(CSV_BOM + csvHeader(columns)));
  while (batch.rows.length > 0) {
    const cells = batch.rows.map((row) => columns.map((c) => cellOf(row[c.name])));
    await sink.writer.write(UTF8.encode(lines(cells)));
    if (batch.rows.length < BATCH_ROWS) {
      return;
    }
    stillAllowed(deps, deadline);
    batch = await nextBatch(exec);
  }
}

/**
 * What an export reads: the author's SQL, and the scope it reads under -- `null` or absent for the
 * BI login, which reads every model; a reader's models for the scope login that reads only those
 * (ADR 0142).
 */
export type ExportInput = ExportQueryRequest & { readonly scope?: QueryScope | null };

/** The whole export, as the tenant's BI login or its scope login, inside the read-only frame. */
async function writeExport(deps: ExportDeps, input: ExportInput, sink: Sink): Promise<void> {
  const roles = await tenantRolesFor(deps.exec, input.tenantId);
  if (roles === null) {
    throw new TenantNotProvisioned(input.tenantId);
  }
  const frame = { schema: roles.analyticsSchema, timeoutMs: EXPORT_STATEMENT_TIMEOUT_MS };
  const target = { tenantId: input.tenantId, kind: "bi" as const, scope: input.scope ?? null };
  await deps.sessions.as(target, (exec) =>
    inReadOnlyTransaction(exec, frame, () => writeRows(deps, exec, input.sql, sink)),
  );
}

/** A whole export: the file ends. A reader that went away has errored it already; that is moot. */
async function finish(writer: WritableStreamDefaultWriter<Uint8Array>): Promise<void> {
  try {
    await writer.close();
  } catch {
    // The reader cancelled; there is no file left to end.
  }
}

/** An export that failed after its first byte: the stream errors, and the reason is logged. */
async function cut(
  deps: ExportDeps,
  tenantId: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  error: unknown,
): Promise<void> {
  // The type, never the message: Postgres's sentence can quote a row value.
  deps.log?.warn("export_cut", { tenantId, errorType: describeError(error).errorType });
  try {
    await writer.abort(error);
  } catch {
    // Already errored by a reader that went away.
  }
}

/** See the module docstring. */
export function exportQuery(
  deps: ExportDeps,
  input: ExportInput,
): Promise<ReadableStream<Uint8Array>> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  return new Promise((resolve, reject) => {
    let started = false;
    function begin(): void {
      started = true;
      resolve(readable);
    }
    function failed(error: unknown): Promise<void> {
      if (started) {
        return cut(deps, input.tenantId, writer, error);
      }
      // No turn in time, or a stop while waiting: nothing ran, and asked again it will.
      reject(error instanceof NotStarted ? new TenantBusy({ cause: error }) : error);
      return Promise.resolve();
    }
    const options = {
      waitMs: TURN_WAIT_MS,
      ...(deps.stop === undefined ? {} : { stop: deps.stop }),
    };
    void turnsFor(deps.turns, "export")
      .run(() => writeExport(deps, input, { writer, begin }), options)
      .then(() => finish(writer), failed);
  });
}
