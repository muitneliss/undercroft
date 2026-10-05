/**
 * What a file labelled as a spreadsheet actually is, read from its bytes. ADR 0104 decision 5.
 *
 * A provider's label is often wrong for spreadsheets in particular: Outlook sends an `.xlsx` as
 * `application/vnd.ms-excel`, a web export saves an HTML table as `.xls`, and Gmail calls a file
 * it does not recognise `application/octet-stream`. The declared type still decides WHETHER a
 * document is treated as a spreadsheet at all; inside that family the container decides which
 * reader opens it. That is reading a fact the file states -- its signature, its own content-types
 * part, the streams at its root -- and never a guess from its name, which is not consulted here.
 */

import { openCfb } from "./cfb.ts";
import { readZipIndex, readZipText } from "./zip.ts";

export type WorkbookKind =
  /** A zip whose content-types part names a spreadsheet: a workbook, template or macro one. */
  | "ooxml"
  /** A zip whose main part is the binary workbook (`.xlsb`). */
  | "xlsb"
  /** A zip whose content-types part names some other main part: a `.docx`, a `.pptx`. */
  | "other-package"
  /** A zip that says nothing either way: no content-types part, or none of its types known. */
  | "unlabelled-package"
  /** A compound file holding an Excel 97–2003 `Workbook` stream (BIFF8). */
  | "biff8"
  /** A compound file holding an Excel 5/95 `Book` stream (BIFF5). */
  | "biff5"
  /** A compound file holding an encrypted OOXML package: a workbook saved with a password. */
  | "encrypted"
  /** Any other compound file: a `.doc`, an `.msg`. */
  | "other-compound"
  /** Markup: an HTML table, or SpreadsheetML 2003, saved under an Excel name. */
  | "markup"
  /** None of the above. */
  | "unknown";

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];
const CONTENT_TYPES = "[Content_Types].xml";
/** How far into a file to look for markup's first tag: a BOM, a declaration, whitespace. */
const MARKUP_PROBE = 1024;

const SPREADSHEET_MAIN =
  /spreadsheetml\.(?:sheet|template)\.main\+xml|ms-excel\.(?:sheet|template)\.macroenabled\.main\+xml/iu;
/**
 * The binary workbook's main part. Excel writes the first spelling; [MS-XLSB] §2.1.7.61 gives
 * the second, so a writer that follows the spec is recognised too.
 */
const BINARY_MAIN = /ms-excel\.sheet\.binary\.macroenabled\.main|ms-excel\.main(?![\w.+])/iu;
const OTHER_MAIN =
  /(?:wordprocessingml|presentationml)\.[a-z.]+\.main\+xml|ms-(?:word|powerpoint)\.[a-z.]+\.main\+xml/iu;
const MARKUP_START = /^(?:﻿)?\s*<(?:!doctype\s+html|html|table|\?xml|meta|head|body)\b/iu;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, at) => bytes[at] === byte);
}

function packageKind(bytes: Uint8Array): WorkbookKind {
  const types = readZipText(bytes, readZipIndex(bytes), CONTENT_TYPES);
  if (types === null) {
    return "unlabelled-package";
  }
  if (BINARY_MAIN.test(types)) {
    return "xlsb";
  }
  if (SPREADSHEET_MAIN.test(types)) {
    return "ooxml";
  }
  return OTHER_MAIN.test(types) ? "other-package" : "unlabelled-package";
}

function compoundKind(bytes: Uint8Array): WorkbookKind {
  const cfb = openCfb(bytes);
  if (cfb === null) {
    return "unknown";
  }
  if (cfb.has("EncryptionInfo") && cfb.has("EncryptedPackage")) {
    return "encrypted";
  }
  if (cfb.has("Workbook")) {
    return "biff8";
  }
  return cfb.has("Book") ? "biff5" : "other-compound";
}

/** What these bytes are, as far as a spreadsheet reader is concerned. */
export function workbookKindOf(bytes: Uint8Array): WorkbookKind {
  if (startsWith(bytes, ZIP_SIGNATURE)) {
    return packageKind(bytes);
  }
  if (startsWith(bytes, CFB_SIGNATURE)) {
    return compoundKind(bytes);
  }
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, MARKUP_PROBE));
  return MARKUP_START.test(head) ? "markup" : "unknown";
}
