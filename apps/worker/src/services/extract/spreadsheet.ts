/**
 * A file labelled as a spreadsheet, opened by what its bytes are. ADR 0104 decision 5.
 *
 * `workbookKind.ts` says what the bytes are; this decides what each kind is read as, and reads
 * the workbooks (`xlsx.ts`, `biff8.ts`, `xlsb.ts`). Read in process, spawning nothing: a workbook
 * is a zip of XML or of binary records, or a compound file of them, and `zip.ts` argues why that
 * is cheaper here than either a converter binary or a dependency.
 */

import { readArchive } from "./archive.ts";
import { type Extracted, MAX_TEXT_CHARS, read, refused, UNSUPPORTED_TYPE } from "./extracted.ts";
import { decodeHtmlBytes, htmlToText } from "./html.ts";
import { readBiff8 } from "./biff8.ts";
import { type WorkbookKind, workbookKindOf } from "./workbookKind.ts";
import { readXlsb } from "./xlsb.ts";
import { readWorkbook } from "./xlsx.ts";

/** An Excel 97–2003 workbook whose records break off, never read as a shorter one. */
export const XLS_UNREADABLE = "xls-unreadable";
/** A package the workbook reader could not open exactly -- never an empty workbook. */
export const XLSX_UNREADABLE = "xlsx-unreadable";
/** A binary workbook whose workbook part, shared strings or styles cannot be read exactly. */
export const XLSB_UNREADABLE = "xlsb-unreadable";
/**
 * A file labelled as a spreadsheet whose bytes say otherwise. Each names what the bytes are, so
 * an operator reading the ledger knows which sender to ask for what. (`xlsb-unsupported` was
 * one until the binary workbook was read, ADR 0109; a row refused under it keeps it until the
 * next extract pass reads it again.)
 */
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

/** An Excel 97–2003 workbook (`biff8.ts`): the same sheets of rows an `.xlsx` gives. */
async function readLegacyWorkbook(bytes: Uint8Array): Promise<Extracted> {
  const reading = await readBiff8(bytes, MAX_TEXT_CHARS);
  if (reading === "encrypted") {
    return refused(WORKBOOK_PASSWORD_PROTECTED);
  }
  if (reading === null || reading === "unreadable") {
    return refused(XLS_UNREADABLE);
  }
  return { ...read("xls", reading.text, reading.short), workbook: reading.workbook };
}

/** An Excel binary workbook (`xlsb.ts`, ADR 0109): the same sheets of rows an `.xlsx` gives. */
async function readBinaryWorkbook(bytes: Uint8Array): Promise<Extracted> {
  const reading = await readXlsb(bytes, MAX_TEXT_CHARS);
  return reading === null
    ? refused(XLSB_UNREADABLE)
    : { ...read("xlsb", reading.text, reading.short), workbook: reading.workbook };
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
  xlsb: readBinaryWorkbook,
  biff8: readLegacyWorkbook,
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

/** A package whose own content-types part names a workbook, XML or binary, whatever its label. */
function namesAWorkbook(kind: WorkbookKind): kind is "ooxml" | "xlsb" {
  return kind === "ooxml" || kind === "xlsb";
}

/**
 * A file labelled a zip: a workbook when its content-types part names one, and otherwise an
 * archive -- refused `archive-unreadable` when its bytes are no zip at all (ADR 0108).
 */
export async function readLabelledArchive(bytes: Uint8Array): Promise<Extracted> {
  const kind = workbookKindOf(bytes);
  return namesAWorkbook(kind) ? await READING[kind](bytes) : readArchive(bytes);
}

/**
 * A file its provider could not name -- `application/octet-stream`, a bare zip -- read as a
 * workbook only when its own content-types part says it is one, and as an archive when it is a
 * zip that names no package at all (ADR 0108). Anything else stays what it always was: a type
 * nobody reads.
 */
export async function readUnlabelled(bytes: Uint8Array): Promise<Extracted> {
  const kind = workbookKindOf(bytes);
  if (namesAWorkbook(kind)) {
    return await READING[kind](bytes);
  }
  return kind === "unlabelled-package" ? readArchive(bytes) : refused(UNSUPPORTED_TYPE);
}
