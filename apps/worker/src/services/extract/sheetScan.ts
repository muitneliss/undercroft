/**
 * One worksheet part read as it inflates, into rows of placed cells, and how the read ended.
 *
 * STREAMED, NEVER HELD WHOLE (ADR 0106). A sheet's XML is the one part of a workbook that grows
 * with its data: a year's ledger inflates past a hundred megabytes, and held whole -- the bytes,
 * then the string -- it was refused at `zip.ts`'s 32 MiB ceiling on any machine the worker runs
 * on. So each piece the inflater hands over is appended to what is left of the last, every whole
 * row in it is read and handed on, and only the partial row at its end is carried into the next.
 * What a scan holds is one piece and one row, whatever the sheet's size.
 *
 * The sheet's grammar outside `<sheetData>` is read the same way: `<dimension>` from what comes
 * before it, `<mergeCells>` from what comes after. The cells of a row are `sheetCells.ts`'s.
 */

import { integerOf } from "./numberFormats.ts";
import {
  MAX_ROW,
  ROW,
  ROWS_LIMIT,
  ROWS_OUT_OF_ORDER,
  rowEntries,
  type ScannedRow,
} from "./sheetCells.ts";
import type { PartStream, WorkbookPackage } from "./workbookPackage.ts";
import { attributesOf, PREFIX } from "./xml.ts";
import type { StreamEnd } from "./zip.ts";

/** Why a whole sheet stopped short of its end, beside the row-level reasons `sheetCells.ts` names. */
export const SHEET_UNREADABLE = "sheet-unreadable";
export const SHEET_TOO_LARGE = "sheet-too-large";

/** How a scan ended, and the sheet's facts that sit outside its rows. */
export interface SheetEnd {
  readonly complete: boolean;
  readonly reason: string | null;
  /** The used range the sheet declares, such as `A1:K5012`, or `null` when it declares none. */
  readonly dimension: string | null;
  /** Merged ranges as declared, such as `A1:F1`. */
  readonly merges: readonly string[];
}

const SHEET_DATA_OPEN = new RegExp(`<${PREFIX}sheetData\\b[^>]*?(?<empty>\\/)?>`, "u");
const SHEET_DATA_CLOSE = new RegExp(`<\\/${PREFIX}sheetData>`, "u");
const DIMENSION = new RegExp(`<${PREFIX}dimension\\b(?<attributes>[^>]*?)\\/?>`, "u");
const MERGE = new RegExp(`<${PREFIX}mergeCell\\b(?<attributes>[^>]*?)\\/?>`, "gu");

const ENDED: Readonly<Record<Exclude<StreamEnd, "complete">, string>> = {
  "too-large": SHEET_TOO_LARGE,
  unreadable: SHEET_UNREADABLE,
};

/** Where a scan is in the sheet, and what it holds between pieces. */
interface Scan {
  phase: "head" | "rows" | "tail";
  /** The text not yet read: the head so far, a partial row, or the tail so far. */
  buffer: string;
  head: string;
  previous: number;
}

function refOf(source: string, pattern: RegExp): string | null {
  return attributesOf(pattern.exec(source)?.groups?.attributes ?? "").get("ref") ?? null;
}

function factsOf(scan: Scan): Pick<SheetEnd, "dimension" | "merges"> {
  const tail = scan.phase === "tail" ? scan.buffer : "";
  return {
    dimension: refOf(scan.phase === "head" ? scan.buffer : scan.head, DIMENSION),
    merges: [...tail.matchAll(MERGE)].flatMap((merge) => {
      const ref = attributesOf(merge.groups?.attributes ?? "").get("ref");
      return ref === undefined ? [] : [ref];
    }),
  };
}

/** Leave the head once `<sheetData>` has begun; a self-closing one is a sheet with no rows. */
function enterRows(scan: Scan): void {
  const open = SHEET_DATA_OPEN.exec(scan.buffer);
  if (open === null) {
    return;
  }
  scan.head = scan.buffer.slice(0, open.index);
  scan.buffer = scan.buffer.slice(open.index + open[0].length);
  scan.phase = open.groups?.empty === undefined ? "rows" : "tail";
}

/** One row's number: its `r`, or the one after the row before; `null` when neither can be. */
function rowNumberOf(stated: string | undefined, previous: number): number | null {
  const rowNumber = stated === undefined ? previous + 1 : integerOf(stated);
  return rowNumber === null || rowNumber <= previous ? null : rowNumber;
}

/** One whole `<row>`: read, empty (`null`), or the reason the sheet stops at it. */
function rowOf(
  match: RegExpMatchArray,
  scan: Scan,
  workbook: WorkbookPackage,
): ScannedRow | null | string {
  const attributes = attributesOf(match.groups?.attributes ?? "");
  const rowNumber = rowNumberOf(attributes.get("r"), scan.previous);
  if (rowNumber === null || rowNumber > MAX_ROW) {
    return rowNumber === null ? ROWS_OUT_OF_ORDER : ROWS_LIMIT;
  }
  scan.previous = rowNumber;
  const entries = rowEntries(match.groups?.body ?? "", workbook);
  if (typeof entries === "string" || entries.length === 0) {
    return typeof entries === "string" ? entries : null;
  }
  const hidden = attributes.get("hidden");
  return { rowNumber, hidden: hidden === "1" || hidden === "true", entries };
}

/** The whole rows a piece completed, and the reason the sheet stops after them, if it does. */
interface Taken {
  readonly rows: readonly ScannedRow[];
  readonly stop: string | null;
}

/**
 * Every whole row the buffer holds, in order, up to one that stops the sheet. The buffer keeps
 * only what follows the last whole row -- or, once `</sheetData>` is in it, the tail.
 */
function takeRows(scan: Scan, workbook: WorkbookPackage): Taken {
  const close = SHEET_DATA_CLOSE.exec(scan.buffer);
  const region = close === null ? scan.buffer : scan.buffer.slice(0, close.index);
  const rows: ScannedRow[] = [];
  let taken = 0;
  for (const match of region.matchAll(ROW)) {
    taken = (match.index ?? 0) + match[0].length;
    const row = rowOf(match, scan, workbook);
    if (typeof row === "string") {
      return { rows, stop: row };
    }
    if (row !== null) {
      rows.push(row);
    }
  }
  if (close === null) {
    scan.buffer = scan.buffer.slice(taken);
  } else {
    scan.buffer = scan.buffer.slice(close.index);
    scan.phase = "tail";
  }
  return { rows, stop: null };
}

/**
 * A sheet's non-empty rows in order, read as its part inflates, returning how the read ended.
 *
 * A row out of order, past Excel's last row, or holding a cell that cannot be placed ends the
 * scan, as does a part that breaks or passes the stream ceiling: the rows before are exact, and
 * the end says the sheet is incomplete and why.
 */
export async function* scanSheet(
  open: PartStream,
  workbook: WorkbookPackage,
): AsyncGenerator<ScannedRow, SheetEnd> {
  const stream = open();
  const scan: Scan = { phase: "head", buffer: "", head: "", previous: 0 };
  try {
    for (;;) {
      const step = await stream.next();
      if (step.done === true) {
        const reason = step.value === "complete" ? null : ENDED[step.value];
        return { complete: reason === null, reason, ...factsOf(scan) };
      }
      scan.buffer += step.value;
      if (scan.phase === "head") {
        enterRows(scan);
      }
      const { rows, stop } =
        scan.phase === "rows" ? takeRows(scan, workbook) : { rows: [], stop: null };
      // The rows before a stop are exact, and are handed on before the sheet says it stopped.
      yield* rows;
      if (stop !== null) {
        return { complete: false, reason: stop, ...factsOf(scan) };
      }
    }
  } finally {
    // A scan that stops at a row leaves the inflater open; returning closes it.
    await stream.return("complete");
  }
}
