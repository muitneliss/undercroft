/**
 * The file types a Gmail or Drive connection can be told to land, and their names in the
 * reader's language.
 *
 * WHICH TYPES, AND HOW A FILE MATCHES ONE, IS `@undercroft/contracts`' `FILE_FORMATS` -- the
 * same list the worker matches files against and the docs page describes. This module only
 * names them. A choice is a MIME type, or an extension such as `.oa` for a format that has
 * none of its own.
 *
 * This list is a curated convenience, not the limit of what may be chosen: an admin can add
 * any other MIME type or extension through the picker's free-text field, and
 * `describeFileType` falls back to the raw choice for one this build has no word for -- the
 * same fallback `describeXeroEntity` uses for an entity id.
 */

import {
  FILE_FORMATS,
  type FileFormatId,
  isPlausibleFileChoice,
  normalizeFileChoice,
} from "@undercroft/contracts";
import type { TFunction } from "i18next";

/** Every curated choice, in the order the picker offers them. */
export const CURATED_FILE_TYPES: readonly string[] = FILE_FORMATS.map((format) => format.choice);

const FILE_TYPE_KEY: Record<
  FileFormatId,
  | "scope.fileTypePdf"
  | "scope.fileTypeDocx"
  | "scope.fileTypeDoc"
  | "scope.fileTypeGoogleDoc"
  | "scope.fileTypeXlsx"
  | "scope.fileTypeXlsm"
  | "scope.fileTypeXls"
  | "scope.fileTypeGoogleSheet"
  | "scope.fileTypeGoogleSlides"
  | "scope.fileTypeCsv"
  | "scope.fileTypeTxt"
  | "scope.fileTypeMarkdown"
  | "scope.fileTypeHtml"
  | "scope.fileTypeMhtml"
  | "scope.fileTypeEml"
  | "scope.fileTypeXml"
  | "scope.fileTypeJson"
  | "scope.fileTypeOpenAttestation"
  | "scope.fileTypeJpeg"
  | "scope.fileTypePng"
  | "scope.fileTypeWebp"
> = {
  pdf: "scope.fileTypePdf",
  docx: "scope.fileTypeDocx",
  doc: "scope.fileTypeDoc",
  googleDoc: "scope.fileTypeGoogleDoc",
  xlsx: "scope.fileTypeXlsx",
  xlsm: "scope.fileTypeXlsm",
  xls: "scope.fileTypeXls",
  googleSheet: "scope.fileTypeGoogleSheet",
  googleSlides: "scope.fileTypeGoogleSlides",
  csv: "scope.fileTypeCsv",
  txt: "scope.fileTypeTxt",
  markdown: "scope.fileTypeMarkdown",
  html: "scope.fileTypeHtml",
  mhtml: "scope.fileTypeMhtml",
  eml: "scope.fileTypeEml",
  xml: "scope.fileTypeXml",
  json: "scope.fileTypeJson",
  openAttestation: "scope.fileTypeOpenAttestation",
  jpeg: "scope.fileTypeJpeg",
  png: "scope.fileTypePng",
  webp: "scope.fileTypeWebp",
};

/** Whether a chosen type is one the checklist already offers, or a custom addition. */
export function isCuratedFileType(value: string): boolean {
  return CURATED_FILE_TYPES.includes(value);
}

/** A file type's name for a reader; a choice this build has no word for keeps its raw spelling. */
export function describeFileType(t: TFunction, choice: string): string {
  const format = FILE_FORMATS.find((f) => f.choice === choice);
  return format === undefined ? choice : t(FILE_TYPE_KEY[format.id]);
}

/** Whether a custom entry is worth trying, before it is sent anywhere: `type/subtype` or `.ext`. */
export function isPlausibleFileType(value: string): boolean {
  return isPlausibleFileChoice(value);
}

/** Trimmed and lowercased, so a typed-in entry matches what Google's APIs actually send. */
export function normalizeFileType(value: string): string {
  return normalizeFileChoice(value);
}
