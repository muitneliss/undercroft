/**
 * `raw.document_sheets` and `raw.document_rows`: a workbook's sheets and rows, stored by the
 * digest they were read from. `packages/db/sql/460_document_rows.sql`, ADR 0104.
 *
 * ONE WRITE, AND IT REPLACES. A digest's sheets are deleted -- its rows go with them, by the
 * foreign key -- and the new ones inserted, all on the transaction the caller opened. The
 * caller opens it only after a read SUCCEEDED, so a failed re-read never reaches this module
 * and never removes rows already held: the 2,602-document rule in `documentText.ts`, applied to
 * rows (ADR 0104 decision 8).
 *
 * THE DIGEST IS LOCKED FOR THE TRANSACTION. Two extract runs over different sources can read the
 * same bytes -- an attachment also filed in Drive -- and each replaces that digest's rows. Without
 * a lock the two deletes would both run before either insert, and the second insert would fail
 * on the first one's primary key, failing a whole run over a file both had read correctly. A
 * transaction-scoped advisory lock on (tenant, digest) makes the second wait and then replace.
 * In SQL, not in the loader, because a check in application code binds only the process that
 * runs it (`layering.md`).
 *
 * THE TENANT IS A BIND PARAMETER, NEVER THE DATA, for the reason `WRITE_BY_DIGEST` gives in
 * `documentText.ts`: the worker writes past row-level security, so a row stamped with the wrong
 * tenant would be served to that tenant's models as its own.
 */

import type { SqlExecutor } from "@undercroft/db";

/** The bytes a workbook's rows were read from, within one tenant. */
export interface WorkbookKey {
  readonly tenantId: string;
  readonly sha256: string;
}

export interface RowToStore {
  readonly rowNumber: number;
  readonly hidden: boolean;
  readonly cells: Readonly<Record<string, string>>;
  readonly formats: Readonly<Record<string, string>> | null;
  readonly faults: Readonly<Record<string, string>> | null;
}

export interface SheetToStore {
  readonly index: number;
  readonly name: string | null;
  readonly nameReason: string | null;
  readonly kind: string | null;
  readonly state: string;
  readonly dimension: string | null;
  readonly merges: readonly string[];
  readonly rowCount: number;
  readonly complete: boolean;
  readonly reason: string | null;
  /** The sheet's rows, read once and in order; never held whole here. */
  readonly rows: () => Iterable<RowToStore>;
}

export interface WorkbookToStore {
  readonly container: string;
  readonly date1904: boolean | null;
  readonly sheets: readonly SheetToStore[];
}

export interface RowsStamp {
  readonly rowsVersion: number;
  readonly extractedAt: string;
  readonly runId: string;
}

/** Rows sent per statement. Bounded so a million-row sheet is never one array in memory. */
export const ROW_BATCH = 1000;

const LOCK_DIGEST = "SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))";

const DELETE_SHEETS = "DELETE FROM raw.document_sheets WHERE tenant_id = $1 AND sha256 = $2";

const INSERT_SHEET = `INSERT INTO raw.document_sheets
    (tenant_id, sha256, sheet_index, sheet_name, sheet_name_reason, sheet_kind, sheet_state,
     container, date1904, dimension, merges, row_count, complete, reason, rows_version,
     extracted_at, run_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[], $12, $13, $14, $15,
          $16::timestamptz, $17)`;

/**
 * A batch of one sheet's rows. The maps travel as JSON text and are cast here, so a value is a
 * JSON STRING inside `cells` and never a JSON number -- which Postgres would hold, and a model
 * would read, as a float (`money.md`).
 */
const INSERT_ROWS = `INSERT INTO raw.document_rows
    (tenant_id, sha256, sheet_index, row_number, hidden, cells, formats, faults)
  SELECT $1, $2, $3, r.row_number, r.hidden, r.cells::jsonb, r.formats::jsonb, r.faults::jsonb
    FROM unnest($4::integer[], $5::boolean[], $6::text[], $7::text[], $8::text[])
      AS r(row_number, hidden, cells, formats, faults)`;

function jsonOrNull(map: Readonly<Record<string, string>> | null): string | null {
  return map === null ? null : JSON.stringify(map);
}

async function insertRows(
  tx: SqlExecutor,
  key: WorkbookKey,
  sheetIndex: number,
  rows: readonly RowToStore[],
): Promise<void> {
  await tx.query(INSERT_ROWS, [
    key.tenantId,
    key.sha256,
    sheetIndex,
    rows.map((row) => row.rowNumber),
    rows.map((row) => row.hidden),
    rows.map((row) => JSON.stringify(row.cells)),
    rows.map((row) => jsonOrNull(row.formats)),
    rows.map((row) => jsonOrNull(row.faults)),
  ]);
}

/** What every sheet of one write shares. */
interface Write {
  readonly key: WorkbookKey;
  readonly workbook: WorkbookToStore;
  readonly stamp: RowsStamp;
}

async function insertSheet(tx: SqlExecutor, write: Write, sheet: SheetToStore): Promise<void> {
  const { key, workbook, stamp } = write;
  await tx.query(INSERT_SHEET, [
    key.tenantId,
    key.sha256,
    sheet.index,
    sheet.name,
    sheet.nameReason,
    sheet.kind,
    sheet.state,
    workbook.container,
    workbook.date1904,
    sheet.dimension,
    sheet.merges,
    sheet.rowCount,
    sheet.complete,
    sheet.reason,
    stamp.rowsVersion,
    stamp.extractedAt,
    stamp.runId,
  ]);
}

/**
 * Replace the digest's sheets and rows with `workbook`'s, on the caller's transaction. Returns
 * how many rows were written.
 */
export async function replaceWorkbookRows(
  tx: SqlExecutor,
  key: WorkbookKey,
  workbook: WorkbookToStore,
  stamp: RowsStamp,
): Promise<number> {
  await tx.query(LOCK_DIGEST, [key.tenantId, key.sha256]);
  await tx.query(DELETE_SHEETS, [key.tenantId, key.sha256]);
  let written = 0;
  for (const sheet of workbook.sheets) {
    await insertSheet(tx, { key, workbook, stamp }, sheet);
    let batch: RowToStore[] = [];
    for (const row of sheet.rows()) {
      batch.push(row);
      if (batch.length === ROW_BATCH) {
        await insertRows(tx, key, sheet.index, batch);
        written += batch.length;
        batch = [];
      }
    }
    if (batch.length > 0) {
      await insertRows(tx, key, sheet.index, batch);
      written += batch.length;
    }
  }
  return written;
}
