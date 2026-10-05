/**
 * What reading a document comes to: a `method` and the text it produced, or a `reason` why
 * nothing could be read -- and NEVER an empty string standing in for both (`CLAUDE.md` rule 2,
 * ADR 0024). Every reader builds its answer here, so the ceiling and the one character Postgres
 * cannot store are decided once, for all of them.
 */

import type { Archive } from "./archive.ts";
import type { Workbook } from "./xlsx.ts";

/** How the text was read. A new extractor is a new value; the column is deliberately not an enum. */
export type ExtractMethod =
  | "pdf_text"
  | "pdf_ocr"
  | "docx"
  | "doc"
  | "xlsx"
  | "xls"
  | "image_ocr"
  | "txt"
  | "html"
  | "mime"
  | "openattestation"
  | "zip";

/** A type no reader opens: the refusal for a file nobody has written a reader for. */
export const UNSUPPORTED_TYPE = "unsupported-content-type";

/**
 * The ceiling on stored text.
 *
 * A cut document that does not SAY it is cut reads as a complete one that simply lacks the
 * clause you were looking for, so passing this sets `truncated` rather than trimming quietly.
 * 1 MB of text is a long contract several times over; the bytes remain whole in the lake
 * either way, and raising this is a decision about Postgres, not about the archive. A
 * workbook's rows are not cut by it: they are `raw.document_rows`, and a sheet's completeness
 * is its own (ADR 0104 decision 10).
 */
export const MAX_TEXT_CHARS = 1_000_000;

export interface Extracted {
  readonly method: ExtractMethod | null;
  readonly reason: string | null;
  readonly text: string;
  readonly truncated: boolean;
  /** A spreadsheet's sheets and rows, from the same parse as `text` (ADR 0104). */
  readonly workbook?: Workbook;
  /** An archive's members, each to land as a document of its own (ADR 0108). */
  readonly archive?: Archive;
}

/**
 * U+0000, the one character a Postgres `text` column cannot hold.
 *
 * Everything a reader produces reaches the table through `read` below, so this is decided
 * there once rather than in each reader: a NUL is valid UTF-8 and survives the text decode,
 * and the HTML, MIME, Word and OCR paths can each hand one over too.
 */
const NUL = "\u0000";

/**
 * Where a NUL stood, visibly: the character a non-fatal decode already writes for a byte that
 * is not text (`readPlainText`).
 */
const NOT_TEXT = "�";

/**
 * A text made storable and cut to the ceiling, saying whether it was cut.
 *
 * A NUL IS REPLACED, NOT DROPPED, AND DOES NOT REFUSE THE DOCUMENT. Issue #218: one arrived in
 * a batch that is written as a single statement, failed it, and the same batch came back every
 * run -- a backlog that only grew. Postgres cannot store the character, so something has to
 * give, and the three options are not equal:
 *
 * - Refusing the document costs every readable word in it for one byte, which is exactly what
 *   the non-fatal decode was chosen to avoid.
 * - Dropping it is the plausible-looking answer, and that is its defect. A NUL in a text
 *   document is never a word; it is the trace of a file that is not what it was labelled -- a
 *   UTF-16 export with no byte-order mark decodes to every other byte a NUL, and dropping them
 *   would print its ASCII cleanly beside mangled accents, a reading that looks right and is
 *   not (`CLAUDE.md` rule 2).
 * - Replacing it with U+FFFD keeps the text, keeps its length and positions, and leaves the
 *   row saying where something here was not text. That is the choice.
 */
export function storableText(raw: string): { text: string; truncated: boolean } {
  const text = raw.replaceAll(NUL, NOT_TEXT);
  return text.length > MAX_TEXT_CHARS
    ? { text: text.slice(0, MAX_TEXT_CHARS), truncated: true }
    : { text, truncated: false };
}

/**
 * The text as a reader found it, cut to the ceiling and made storable.
 *
 * `cutShort` is a reader saying the text it hands over is not the whole document -- a scan
 * stopped at the page cap, say. It joins the ceiling into one flag because downstream the
 * question is the same one: is this all of it? WHY it is short is the reader's business;
 * THAT it is short is the document's.
 */
export function read(method: ExtractMethod, raw: string, cutShort = false): Extracted {
  const { text, truncated } = storableText(raw);
  return { method, reason: null, text, truncated: truncated || cutShort };
}

/** Nothing read, and why. */
export function refused(reason: string): Extracted {
  return { method: null, reason, text: "", truncated: false };
}
