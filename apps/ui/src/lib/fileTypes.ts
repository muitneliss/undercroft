/**
 * The file types a Gmail or Drive connection can be told to land, and their names in the
 * reader's language.
 *
 * This list is a curated convenience, not the limit of what may be chosen: an admin can add
 * any other MIME type through the picker's free-text field, and `describeFileType` falls back
 * to the raw type for one this build has no word for -- the same fallback `describeXeroEntity`
 * uses for an entity id.
 */

import type { TFunction } from "i18next";

export type CuratedFileType =
  | "application/pdf"
  | "application/msword"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.ms-excel"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "text/csv"
  | "text/plain"
  | "image/jpeg"
  | "image/png";

/** PDF first, then Word/Excel newest-format-first, which is the order the picker offers them. */
export const CURATED_FILE_TYPES: readonly CuratedFileType[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "image/jpeg",
  "image/png",
];

const FILE_TYPE_KEY: Record<
  CuratedFileType,
  | "scope.fileTypePdf"
  | "scope.fileTypeDocx"
  | "scope.fileTypeDoc"
  | "scope.fileTypeXlsx"
  | "scope.fileTypeXls"
  | "scope.fileTypeCsv"
  | "scope.fileTypeTxt"
  | "scope.fileTypeJpeg"
  | "scope.fileTypePng"
> = {
  "application/pdf": "scope.fileTypePdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "scope.fileTypeDocx",
  "application/msword": "scope.fileTypeDoc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "scope.fileTypeXlsx",
  "application/vnd.ms-excel": "scope.fileTypeXls",
  "text/csv": "scope.fileTypeCsv",
  "text/plain": "scope.fileTypeTxt",
  "image/jpeg": "scope.fileTypeJpeg",
  "image/png": "scope.fileTypePng",
};

/** Whether a chosen type is one the checklist already offers, or a custom addition. */
export function isCuratedFileType(value: string): value is CuratedFileType {
  return CURATED_FILE_TYPES.some((type) => type === value);
}

/** A file type's name for a reader; a type this build has no word for keeps its raw MIME type. */
export function describeFileType(t: TFunction, mimeType: string): string {
  return isCuratedFileType(mimeType) ? t(FILE_TYPE_KEY[mimeType]) : mimeType;
}

/** `type/subtype`, the shape every MIME type has. Not a validator against IANA's registry. */
const MIME_TYPE_SHAPE = /^[^/\s]+\/[^/\s]+$/u;

/** Whether a custom entry is worth trying, before it is sent anywhere. */
export function isPlausibleMimeType(value: string): boolean {
  return MIME_TYPE_SHAPE.test(value);
}

/** Trimmed and lowercased, so a typed-in entry matches what Google's APIs actually send. */
export function normalizeFileType(value: string): string {
  return value.trim().toLowerCase();
}
