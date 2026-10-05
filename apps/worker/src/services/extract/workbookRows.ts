/**
 * A workbook's rows written by the digest they were read from, and counted for the run.
 * ADR 0104; the table is `raw.document_rows` (460), the write is `repos/documentRows.ts`.
 *
 * ONE TRANSACTION PER DIGEST, opened only after a read succeeded: a refused read never reaches
 * here, so a failed re-read leaves the rows already held where they are (decision 8).
 */

import { replaceWorkbookRows } from "../../repos/documentRows.ts";
import type { Transactor } from "../runTypes.ts";
import type { Workbook } from "./xlsx.ts";

/**
 * The generation of workbook rows (`raw.document_sheets.rows_version`). Every sheet a workbook
 * read writes is stamped with it. Bump it when what a workbook's rows HOLD changes -- a new fact
 * recorded, a cell placed differently -- and the backfill re-reads every workbook whose rows are
 * older, replacing them only where the new read succeeds (decision 9).
 */
export const CURRENT_ROWS_VERSION = 1;

/** What a pass wrote, in counts only: a sheet's name is text a person wrote. */
export interface WorkbookCounts {
  readonly workbooks: number;
  readonly sheets: number;
  readonly rows: number;
}

export interface WorkbookWriter {
  /** Replace the rows of the workbook read from `sha256`. */
  readonly write: (sha256: string, workbook: Workbook) => Promise<void>;
  readonly counts: () => WorkbookCounts;
}

/** A writer for one pass over one tenant, stamping every sheet with the pass's run. */
export function workbookWriter(
  transactor: Transactor,
  pass: { readonly tenantId: string; readonly extractedAt: string; readonly runId: string },
): WorkbookWriter {
  let workbooks = 0;
  let sheets = 0;
  let rows = 0;
  const stamp = {
    rowsVersion: CURRENT_ROWS_VERSION,
    extractedAt: pass.extractedAt,
    runId: pass.runId,
  };
  return {
    async write(sha256, workbook): Promise<void> {
      const key = { tenantId: pass.tenantId, sha256 };
      rows += await transactor((tx) => replaceWorkbookRows(tx, key, workbook, stamp));
      workbooks += 1;
      sheets += workbook.sheets.length;
    },
    counts: (): WorkbookCounts => ({ workbooks, sheets, rows }),
  };
}
