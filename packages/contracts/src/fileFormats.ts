/**
 * The file formats a Gmail or Drive connection can be told to land.
 *
 * ONE CATALOGUE, THREE READERS OF IT. The picker offers these entries, the collectors match a
 * file against the chosen ones, and `docs/reference/file-formats.md` describes each --
 * `fileFormatsDoc.test.ts` fails when an entry has no section, so the page cannot fall behind the picker. What a
 * format is CALLED is the UI's business (`apps/ui/src/lib/fileTypes.ts`); this module holds no
 * sentence a person reads.
 *
 * A CHOICE IS WHAT A SCOPE STORES. For every format with a MIME type of its own that is the
 * MIME type, exactly as before this catalogue existed, so a selection saved yesterday means
 * what it meant. A format that has none -- `.oa`, which Drive and Gmail both hand over as
 * `application/octet-stream` -- is chosen by EXTENSION, and its choice says so literally:
 * `.oa`. The free-text field accepts both shapes for the same reason.
 *
 * HOW A FILE IS MATCHED AGAINST THEM is `fileMatching.ts`.
 */

/** How much of a format's content the worker's readers turn into text. The docs page's column. */
export type ReadLevel = "text" | "table" | "ocr" | "metadata";

/** A union rather than `string`, so the UI's table of names cannot miss one. */
export type FileFormatId =
  | "pdf"
  | "docx"
  | "doc"
  | "googleDoc"
  | "xlsx"
  | "xlsm"
  | "xls"
  | "googleSheet"
  | "googleSlides"
  | "csv"
  | "txt"
  | "markdown"
  | "html"
  | "mhtml"
  | "eml"
  | "xml"
  | "json"
  | "openAttestation"
  | "jpeg"
  | "png"
  | "webp";

export interface FileFormat {
  /** Stable, for the UI's word for it and the docs page's anchor. */
  readonly id: FileFormatId;
  /** What a scope stores when this format is ticked: its MIME type, or `.ext` for name-only. */
  readonly choice: string;
  /** Every MIME type a provider sends for it; the first is the choice, when there is one. */
  readonly mimeTypes: readonly string[];
  /** Lowercase, without the dot. */
  readonly extensions: readonly string[];
  /** A public specification of the format, for the docs page. */
  readonly spec: string;
  readonly reads: ReadLevel;
  /**
   * The type a Google-native file is EXPORTED as. Such a file has no bytes of its own -- its
   * content is a pointer into Google's editor -- so downloading it answers nothing and it must
   * be exported to land at all.
   */
  readonly exportAs?: string;
  /** The type a file recognised by name alone is catalogued under. See {@link landedType}. */
  readonly landsAs?: string;
}

const GOOGLE_EXPORT_SPEC =
  "https://developers.google.com/workspace/drive/api/guides/ref-export-formats";
const OOXML_SPEC = "https://ecma-international.org/publications-and-standards/standards/ecma-376/";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * In the order the picker offers them: documents, then spreadsheets, then text and web, then
 * signed records, then images. Nothing here is a zip, a rar, a HEIC or a TIFF: none of them
 * has a reader, and offering a format the worker lands but cannot read is a promise with
 * nothing behind it.
 */
export const FILE_FORMATS: readonly FileFormat[] = [
  {
    id: "pdf",
    choice: "application/pdf",
    mimeTypes: ["application/pdf"],
    extensions: ["pdf"],
    spec: "https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf",
    reads: "text",
  },
  {
    id: "docx",
    choice: DOCX,
    mimeTypes: [DOCX],
    extensions: ["docx"],
    spec: OOXML_SPEC,
    reads: "text",
  },
  {
    id: "doc",
    choice: "application/msword",
    mimeTypes: ["application/msword"],
    extensions: ["doc"],
    spec: "https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/",
    reads: "metadata",
  },
  {
    id: "googleDoc",
    choice: "application/vnd.google-apps.document",
    mimeTypes: ["application/vnd.google-apps.document"],
    extensions: [],
    spec: GOOGLE_EXPORT_SPEC,
    reads: "text",
    exportAs: DOCX,
  },
  {
    id: "xlsx",
    choice: XLSX,
    mimeTypes: [XLSX],
    extensions: ["xlsx"],
    spec: OOXML_SPEC,
    reads: "table",
  },
  {
    id: "xlsm",
    choice: "application/vnd.ms-excel.sheet.macroenabled.12",
    // IANA registers it with a capital E and Drive answers that spelling. MIME types are
    // case-insensitive (RFC 2045 §5.1) and matching here lowercases both sides, but Drive's
    // `q=` compares a string, so the registered spelling is listed for the query to ask for.
    mimeTypes: [
      "application/vnd.ms-excel.sheet.macroenabled.12",
      "application/vnd.ms-excel.sheet.macroEnabled.12",
    ],
    extensions: ["xlsm"],
    spec: OOXML_SPEC,
    reads: "table",
  },
  {
    id: "xls",
    choice: "application/vnd.ms-excel",
    mimeTypes: ["application/vnd.ms-excel"],
    extensions: ["xls"],
    spec: "https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/",
    reads: "metadata",
  },
  {
    id: "googleSheet",
    choice: "application/vnd.google-apps.spreadsheet",
    mimeTypes: ["application/vnd.google-apps.spreadsheet"],
    extensions: [],
    spec: GOOGLE_EXPORT_SPEC,
    reads: "table",
    exportAs: XLSX,
  },
  {
    id: "googleSlides",
    choice: "application/vnd.google-apps.presentation",
    mimeTypes: ["application/vnd.google-apps.presentation"],
    extensions: [],
    spec: GOOGLE_EXPORT_SPEC,
    reads: "text",
    exportAs: "text/plain",
  },
  {
    id: "csv",
    choice: "text/csv",
    mimeTypes: ["text/csv"],
    extensions: ["csv"],
    spec: "https://www.rfc-editor.org/rfc/rfc4180",
    reads: "text",
  },
  {
    id: "txt",
    choice: "text/plain",
    mimeTypes: ["text/plain"],
    extensions: ["txt"],
    spec: "https://www.rfc-editor.org/rfc/rfc2046",
    reads: "text",
  },
  {
    id: "markdown",
    choice: "text/markdown",
    mimeTypes: ["text/markdown", "text/x-markdown"],
    extensions: ["md"],
    spec: "https://spec.commonmark.org/",
    reads: "text",
  },
  {
    id: "html",
    choice: "text/html",
    mimeTypes: ["text/html"],
    extensions: ["html", "htm"],
    spec: "https://html.spec.whatwg.org/multipage/",
    reads: "text",
  },
  {
    id: "mhtml",
    choice: "multipart/related",
    mimeTypes: ["multipart/related"],
    extensions: ["mhtml", "mht"],
    spec: "https://www.rfc-editor.org/rfc/rfc2557",
    reads: "text",
  },
  {
    id: "eml",
    choice: "message/rfc822",
    mimeTypes: ["message/rfc822"],
    extensions: ["eml"],
    spec: "https://www.rfc-editor.org/rfc/rfc5322",
    reads: "text",
  },
  {
    id: "xml",
    choice: "application/xml",
    mimeTypes: ["application/xml", "text/xml"],
    extensions: ["xml", "xbrl"],
    spec: "https://www.w3.org/TR/xml/",
    reads: "text",
  },
  {
    id: "json",
    choice: "application/json",
    mimeTypes: ["application/json"],
    extensions: ["json"],
    spec: "https://www.json.org/json-en.html",
    reads: "text",
  },
  {
    id: "openAttestation",
    choice: ".oa",
    mimeTypes: [],
    extensions: ["oa"],
    spec: "https://schema.openattestation.com/2.0/schema.json",
    reads: "text",
    // An OpenAttestation document IS a JSON document, and no MIME type is registered for
    // it. Catalogued as JSON, the JSON reader recognises it by its content -- never by this
    // name -- which is the only recognition a signed record can rest on.
    landsAs: "application/json",
  },
  {
    id: "jpeg",
    choice: "image/jpeg",
    mimeTypes: ["image/jpeg", "image/jpg"],
    extensions: ["jpg", "jpeg"],
    spec: "https://www.w3.org/Graphics/JPEG/itu-t81.pdf",
    reads: "ocr",
  },
  {
    id: "png",
    choice: "image/png",
    mimeTypes: ["image/png"],
    extensions: ["png"],
    spec: "https://www.w3.org/TR/png/",
    reads: "ocr",
  },
  {
    id: "webp",
    choice: "image/webp",
    mimeTypes: ["image/webp"],
    extensions: ["webp"],
    spec: "https://developers.google.com/speed/webp/docs/riff_container",
    reads: "ocr",
  },
];
