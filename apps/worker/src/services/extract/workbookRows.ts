/**
 * A workbook's rows written by the digest they were read from, owed rows written for workbooks
 * read before them, and the counts a run reports. ADR 0104; the tables are 460 and 470.
 *
 * ONE TRANSACTION PER DIGEST, opened only after a read succeeded: a refused read never reaches
 * a write, so a failed re-read leaves the rows and the text already held where they are
 * (decision 8).
 */

import type { SqlExecutor } from "@undercroft/db";

import { replaceWorkbookRows } from "../../repos/documentRows.ts";
import {
  type OwedWorkbook,
  owedWorkbooks,
  refuseWorkbookRows,
  removeOrphanWorkbooks,
  rewriteWorkbookText,
} from "../../repos/workbookBacklog.ts";
import type { Transactor } from "../runTypes.ts";
import type { Extracted } from "./extracted.ts";
import type { Workbook } from "./xlsx.ts";

/**
 * The generation of workbook rows (`raw.document_sheets.rows_version`). Every sheet a workbook
 * read writes is stamped with it. Bump it when what a workbook's rows HOLD changes -- a new fact
 * recorded, a cell placed differently -- and the backfill re-reads every workbook whose rows are
 * older, replacing them only where the new read succeeds (decision 9).
 */
export const CURRENT_ROWS_VERSION = 1;

/** The text methods a workbook is read by: the ones whose read also yields rows. */
export const WORKBOOK_METHODS: readonly string[] = ["xlsx", "xls"];

/** Digests whose orphaned rows one pass removes, at most. */
const ORPHANS_PER_PASS = 500;

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

/** Where one pass writes: the tenant, and the run every sheet is stamped with. */
export interface WorkbookPass {
  readonly tenantId: string;
  readonly extractedAt: string;
  readonly runId: string;
}

function stampOf(pass: WorkbookPass): { rowsVersion: number; extractedAt: string; runId: string } {
  return { rowsVersion: CURRENT_ROWS_VERSION, extractedAt: pass.extractedAt, runId: pass.runId };
}

/** A writer for one pass over one tenant, stamping every sheet with the pass's run. */
export function workbookWriter(transactor: Transactor, pass: WorkbookPass): WorkbookWriter {
  let workbooks = 0;
  let sheets = 0;
  let rows = 0;
  return {
    async write(sha256, workbook): Promise<void> {
      const key = { tenantId: pass.tenantId, sha256 };
      rows += await transactor((tx) => replaceWorkbookRows(tx, key, workbook, stampOf(pass)));
      workbooks += 1;
      sheets += workbook.sheets.length;
    },
    counts: (): WorkbookCounts => ({ workbooks, sheets, rows }),
  };
}

/** What a backfill did, in digests. */
export interface Backfilled {
  /** Workbooks given their rows, their text brought to the same reading. */
  readonly written: number;
  /** Workbooks the current reader refused: nothing replaced, the reason recorded. */
  readonly refused: number;
  /** Workbooks whose bytes the lake did not hand back: nothing recorded, asked again next pass. */
  readonly unreadable: number;
  /** Digests no live document holds any more, their rows removed. */
  readonly orphans: number;
}

/**
 * Read again, from the lake, this scope's workbooks owed their rows, and write them; then remove
 * the rows no live document of the tenant needs. `read` is the pass's own read, so the backfill
 * opens a workbook exactly as a first read does; it answers `null` when the lake could not.
 */
export async function backfillWorkbooks(
  deps: { readonly exec: SqlExecutor; readonly transactor: Transactor },
  pass: WorkbookPass & { readonly source: string; readonly limit: number },
  read: (owed: OwedWorkbook) => Promise<Extracted | null>,
): Promise<Backfilled> {
  const owed = await owedWorkbooks(
    deps.exec,
    { tenantId: pass.tenantId, source: pass.source },
    { methods: WORKBOOK_METHODS, rowsVersion: CURRENT_ROWS_VERSION, limit: pass.limit },
  );
  let written = 0;
  let refused = 0;
  let unreadable = 0;
  for (const document of owed) {
    const extracted = await read(document);
    const key = { tenantId: pass.tenantId, sha256: document.sha256 };
    const { workbook } = extracted ?? {};
    if (extracted === null) {
      unreadable += 1;
    } else if (workbook === undefined) {
      refused += 1;
      const reason = extracted.reason ?? "workbook-not-read";
      await refuseWorkbookRows(deps.exec, key, {
        ...stampOf(pass),
        reason,
        refusedAt: pass.extractedAt,
      });
    } else {
      written += 1;
      const reading = { ...extracted, methods: WORKBOOK_METHODS, ...stampOf(pass) };
      await deps.transactor(async (tx) => {
        await replaceWorkbookRows(tx, key, workbook, stampOf(pass));
        await rewriteWorkbookText(tx, key, reading);
      });
    }
  }
  const orphans = await removeOrphanWorkbooks(deps.exec, pass.tenantId, ORPHANS_PER_PASS);
  return { written, refused, unreadable, orphans };
}
