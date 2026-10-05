/**
 * A file labelled as a spreadsheet, opened by what its bytes are. ADR 0104 decision 5.
 *
 * `workbookKind.ts` says what the bytes are; this decides what each kind is read as, and reads
 * the workbooks (`xlsx.ts`). Read in process, spawning nothing: a workbook is a zip of XML, and
 * `xlsx.ts` argues why that is cheaper here than either a converter binary or a dependency.
 */

import { type Extracted, MAX_TEXT_CHARS, read, refused, UNSUPPORTED_TYPE } from "./extracted.ts";
import { decodeHtmlBytes, htmlToText } from "./html.ts";
import { type WorkbookKind, workbookKindOf } from "./workbookKind.ts";
import { readWorkbook } from "./xlsx.ts";

/**
 * The pre-2007 binary workbook, refused by name until its reader exists: its container is the
 * one `cfb.ts` opens for Word, but BIFF's cell records are a second format entirely. Its own
 * reason rather than `legacy-doc-unsupported`, so an operator reading the ledger need not know
 * the Word reason was meant to cover spreadsheets too.
 */
export const LEGACY_XLS = "legacy-xls-unsupported";
/** A package the workbook reader could not open exactly -- never an empty workbook. */
export const XLSX_UNREADABLE = "xlsx-unreadable";
/**
 * A file labelled as a spreadsheet whose bytes say otherwise. Each names what the bytes are, so
 * an operator reading the ledger knows which sender to ask for what.
 */
export const XLSB_UNSUPPORTED = "xlsb-unsupported";
export const XLS_BIFF5 = "xls-biff5-unsupported";
export const WORKBOOK_PASSWORD_PROTECTED = "workbook-password-protected";
export const WORKBOOK_NOT_A_WORKBOOK = "workbook-not-a-workbook";

/**
 * A workbook's sheets and their text. `null` is a workbook we could not open exactly -- never
 * an empty one. A workbook with a sheet that stopped short is read, and its text says it is
 * short (`truncated`), because the sheets it holds are no longer the whole workbook.
 */
async function readSpreadsheet(bytes: Uint8Array): Promise<Extracted> {
  const reading = await readWorkbook(bytes, MAX_TEXT_CHARS);
  return reading === null
    ? refused(XLSX_UNREADABLE)
    : { ...read("xlsx", reading.text, reading.short), workbook: reading.workbook };
}

/** An HTML table, or SpreadsheetML markup, saved under an Excel name: the text a reader sees. */
function readMarkup(bytes: Uint8Array): Extracted {
  return read("html", htmlToText(decodeHtmlBytes(bytes)));
}

/**
 * What each kind is read as. A package that says nothing about its parts is offered to the
 * workbook reader, which refuses it by name if it holds no sheet.
 */
const READING: Readonly<
  Record<WorkbookKind, (bytes: Uint8Array) => Extracted | Promise<Extracted>>
> = {
  ooxml: readSpreadsheet,
  "unlabelled-package": readSpreadsheet,
  markup: readMarkup,
  xlsb: () => refused(XLSB_UNSUPPORTED),
  biff8: () => refused(LEGACY_XLS),
  biff5: () => refused(XLS_BIFF5),
  encrypted: () => refused(WORKBOOK_PASSWORD_PROTECTED),
  "other-package": () => refused(WORKBOOK_NOT_A_WORKBOOK),
  "other-compound": () => refused(WORKBOOK_NOT_A_WORKBOOK),
  unknown: () => refused(WORKBOOK_NOT_A_WORKBOOK),
};

/** A file labelled as one of Excel's types, read as what its bytes are. */
export async function readLabelledSpreadsheet(bytes: Uint8Array): Promise<Extracted> {
  return await Promise.resolve(READING[workbookKindOf(bytes)](bytes));
}

/**
 * A file its provider could not name -- `application/octet-stream`, a bare zip -- read as a
 * workbook only when its own content-types part says it is one. Anything else stays what it
 * always was: a type nobody reads.
 */
export async function readUnlabelled(bytes: Uint8Array): Promise<Extracted> {
  return workbookKindOf(bytes) === "ooxml"
    ? await readSpreadsheet(bytes)
    : refused(UNSUPPORTED_TYPE);
}
