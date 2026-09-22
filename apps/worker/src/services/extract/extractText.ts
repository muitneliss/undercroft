/**
 * What a document says, and how we came to read it.
 *
 * One function per way of reading, dispatched on the content type the catalogue recorded.
 * Every one of them answers with a `method` -- how the text was obtained -- or a `reason` why
 * it could not be, and NEVER with an empty string standing in for both. A document that says
 * nothing and a document nobody could open are different facts, and collapsing them is the
 * silent zero this codebase refuses everywhere else (`CLAUDE.md` rule 2, ADR 0024).
 *
 * HOW A NATIVE PROGRAM IS RUN is `program.ts`'s business, not this module's: that a binary is
 * invoked rather than imported, that the spawn is injected so the offline gate needs neither
 * poppler nor tesseract installed, and that an absent binary is a refusal naming the program
 * instead of a crashed run. The readers below ask for text and get text or a reason.
 */

import { readDocx } from "./docx.ts";
import { ocrImage } from "./ocr.ts";
import { type ExtractDeps, extractorMissing, runProgram } from "./program.ts";
import { readXlsx } from "./xlsx.ts";

/** How the text was read. A new extractor is a new value; the column is deliberately not an enum. */
export type ExtractMethod = "pdf_text" | "pdf_ocr" | "docx" | "xlsx" | "image_ocr" | "txt";

/**
 * Why nothing could be read. Each names something an operator can act on.
 *
 * The OCR refusals are `ocr.ts`'s, named there beside the decisions that produce them.
 */
export const LEGACY_DOC = "legacy-doc-unsupported";
export const LEGACY_XLS = "legacy-xls-unsupported";
export const XLSX_UNREADABLE = "xlsx-unreadable";
export const DOCX_UNREADABLE = "docx-unreadable";
export const UNSUPPORTED_TYPE = "unsupported-content-type";
export const EMPTY_SOURCE = "document-has-no-bytes";

/**
 * The ceiling on stored text.
 *
 * A cut document that does not SAY it is cut reads as a complete one that simply lacks the
 * clause you were looking for, so passing this sets `truncated` rather than trimming quietly.
 * 1 MB of text is a long contract several times over; the bytes remain whole in the lake
 * either way, and raising this is a decision about Postgres, not about the archive.
 */
export const MAX_TEXT_CHARS = 1_000_000;

/**
 * The text layer is believed at 80 normalised characters.
 *
 * Taken from the reference implementation this strategy comes from, and the number matters in
 * one direction only: a scanned PDF still carries a few stray characters from a header or a
 * stamp, so "the layer returned something" is not "the layer worked". Eighty is comfortably
 * more than that noise and comfortably less than a page of real text.
 */
export const TEXT_LAYER_MIN_CHARS = 80;

export interface Extracted {
  readonly method: ExtractMethod | null;
  readonly reason: string | null;
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * Whitespace collapsed, so a count means characters a reader would see.
 *
 * A PDF text layer that "returned something" is usually returning form feeds and the page
 * furniture around an image; measuring the raw string would pass that as content.
 */
export function normalizeText(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}

function capped(text: string): { text: string; truncated: boolean } {
  return text.length > MAX_TEXT_CHARS
    ? { text: text.slice(0, MAX_TEXT_CHARS), truncated: true }
    : { text, truncated: false };
}

function read(method: ExtractMethod, raw: string): Extracted {
  const { text, truncated } = capped(raw);
  return { method, reason: null, text, truncated };
}

function refused(reason: string): Extracted {
  return { method: null, reason, text: "", truncated: false };
}

/** Poppler's text layer, straight to stdout. `-layout` keeps columns in reading order. */
export async function pdfTextLayer(
  deps: ExtractDeps,
  path: string,
): Promise<{ ok: true; text: string } | { ok: false; missing: boolean }> {
  const result = await runProgram(deps, ["pdftotext", "-layout", path, "-"]);
  return result.ok ? { ok: true, text: result.output } : result;
}

/** What every reader below is handed. `bytes` is what the lake holds; `path` is where they are. */
interface Document {
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly path: string;
}

type Reader = (deps: ExtractDeps, input: Document) => Extracted | Promise<Extracted>;

/**
 * Decoded non-fatally, so a stray byte in an otherwise readable file costs that byte and not
 * the document. What cannot be decoded at all lands as the replacement character, which is
 * visibly wrong rather than invisibly absent.
 */
function readPlainText(_deps: ExtractDeps, input: Document): Extracted {
  return read("txt", new TextDecoder("utf-8", { fatal: false }).decode(input.bytes));
}

async function readPdf(deps: ExtractDeps, input: Document): Promise<Extracted> {
  const layer = await pdfTextLayer(deps, input.path);
  if (!layer.ok) {
    return refused(layer.missing ? extractorMissing("pdftotext") : "pdftotext-failed");
  }
  if (normalizeText(layer.text).length >= TEXT_LAYER_MIN_CHARS) {
    return read("pdf_text", layer.text);
  }
  // Below the threshold this is a scan, and reading it needs OCR. The document is refused BY
  // NAME rather than stored as the handful of stray characters the layer did return -- which
  // would read downstream as a contract that says almost nothing.
  //
  // IT DOES NOT FALL THROUGH TO `ocr.ts`, and the reason is measured rather than assumed:
  // tesseract's input is an image, so `tesseract scan.pdf stdout` answers "Pdf reading is not
  // supported" and exits 1. Wiring it here would record `tesseract-failed` on every scan --
  // which tells an operator this PDF is broken when the truth is that nobody rasterised it,
  // and a reason that misleads is worse than one that defers. A `pdf_ocr` reader needs a page
  // image first (poppler's `pdftoppm`, already in the worker image), and with it a page cap, a
  // resolution and a deadline spanning N pages instead of one -- its own change, with its own
  // measurement, for the 53 documents this branch covers. `needs-ocr` is what re-queues them
  // when it lands.
  return refused("needs-ocr");
}

/**
 * Read in process, spawning nothing: a workbook is a zip of XML, and `xlsx.ts` argues there
 * why that is cheaper here than either a converter binary or a dependency.
 *
 * `null` is a workbook we could not open exactly -- never an empty one. The two are different
 * facts and an empty string would make them one (`CLAUDE.md` rule 2).
 */
function readWorkbook(_deps: ExtractDeps, input: Document): Extracted {
  const text = readXlsx(input.bytes);
  return text === null ? refused(XLSX_UNREADABLE) : read("xlsx", text);
}

/**
 * Read in process for the same reason a workbook is: a `.docx` is the same zip of XML, and
 * `docx.ts` argues there why reading it lexically is what makes a nested table and a text box
 * arrive rather than silently not.
 *
 * `null` is a document we could not open exactly -- never an empty one.
 */
function readWordDocument(_deps: ExtractDeps, input: Document): Extracted {
  const text = readDocx(input.bytes);
  return text === null ? refused(DOCX_UNREADABLE) : read("docx", text);
}

/**
 * A picture of a document, read by OCR -- or one of `ocr.ts`'s four named refusals.
 *
 * Everything that makes this hard is one module down: whether the bytes are big enough to be a
 * document at all, which languages tesseract is told to expect, and the difference between an
 * engine that could not run and one that ran and found nothing. This layer only decides what
 * an answer is called, which is the same job it does for every other reader.
 */
async function readImage(deps: ExtractDeps, input: Document): Promise<Extracted> {
  const ocr = await ocrImage(deps, input);
  return ocr.ok ? read("image_ocr", ocr.text) : refused(ocr.reason);
}

/**
 * One reader per content type. A NEW EXTRACTOR IS A NEW ENTRY, which is the shape this table
 * exists for: the chain of `if (type === ...)` it replaced grew a branch per format until it
 * was the most complex function in the module, and the cost of the next one was a re-read of
 * all of them.
 *
 * The two `refused` entries are readers too, deliberately. A format we have decided not to
 * support is a decision with a name attached and belongs in the same list as the ones we do --
 * an absent entry means "nobody has thought about this type yet", which is what
 * `UNSUPPORTED_TYPE` says, and the two should not look alike.
 *
 * A `Map` rather than an object literal: the key is a content type from a provider, and a
 * lookup of `constructor` or `__proto__` in a plain object answers with something that is not
 * a reader.
 */
const READERS: ReadonlyMap<string, Reader> = new Map<string, Reader>([
  ["text/plain", readPlainText],
  // A delimited file IS text, and the reader above already decodes it non-fatally. Parsing it
  // into rows instead would mean choosing a delimiter, a quoting style and an encoding that
  // the file does not state -- three guesses for an index that wants the words either way.
  ["text/csv", readPlainText],
  ["text/tab-separated-values", readPlainText],
  ["application/pdf", readPdf],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", readWorkbook],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", readWordDocument],
  // The two image types the connection picker offers and the only two the lake holds: 1,274
  // PNGs and 283 JPEGs, none of them readable until now. `ocr.ts` decides which of them are
  // documents rather than email furniture.
  ["image/png", readImage],
  ["image/jpeg", readImage],
  // The same JPEG under a spelling IANA does not register. Mail clients write it and the
  // catalogue records whatever the provider declared, so without this line a file we can read
  // perfectly well is recorded `unsupported-content-type` over a missing `e`. Nothing
  // downstream keys off the type -- tesseract sniffs the content -- so it is an alias, not a
  // second reader.
  ["image/jpg", readImage],
  // The pre-2007 binary workbook. Reading BIFF needs LibreOffice in the image, which is a
  // container's worth of dependency for two files. Its own reason rather than `LEGACY_DOC`,
  // because an operator reading the ledger should not have to know that the Word reason was
  // meant to cover spreadsheets too.
  ["application/vnd.ms-excel", (): Extracted => refused(LEGACY_XLS)],
  // The pre-2007 binary Word format, refused for the same reason and by name, so it is
  // visible in the ledger rather than absent from it.
  ["application/msword", (): Extracted => refused(LEGACY_DOC)],
]);

/**
 * WHICH GENERATION OF THE TABLE ABOVE THIS IS. BUMP IT WHEN THE READERS CHANGE.
 *
 * Every extraction stamps this on its row, and the backlog offers a REFUSED row back whenever
 * its stamp is older than this number (`repos/documentText.ts`). Without it a refusal is
 * permanent: the document has a row and its bytes have not moved, so nothing would ever ask it
 * again, and a reader added here would ship as a no-op over precisely the files it was written
 * for -- 1,190 of them on production, recorded `unsupported-content-type` for types this table
 * now answers.
 *
 * 1, not 0, because THIS change is the first generation: `0` is what every row written before
 * the column existed carries, and it must sort below anything we bump to so those rows re-enter
 * the queue exactly once.
 *
 * BY HAND, AND DELIBERATELY SO. The honest alternative is deriving it -- hashing the binaries
 * and language packs behind these readers into the stamp, which is what the sibling project
 * does, because installing `tesseract-ocr-vie` changes what OCR can read without changing a
 * line of this file. That is a real gap and this constant does not close it: forget to bump it
 * and the new reader silently reaches nothing already refused. It is the cheap form on purpose,
 * and the trade is worth naming rather than discovering.
 *
 * Bumping is safe because it re-queues only refusals -- a document that was READ is never
 * re-offered, whatever its generation. The predicate in `repos/documentText.ts` carries that
 * argument and the 2,602-document incident behind it.
 */
export const CURRENT_READER_VERSION = 1;

/**
 * One document, read whichever way its type allows.
 *
 * The charset a provider may append is dropped before the lookup: the catalogue stores what
 * was declared, and `text/plain; charset=utf-8` is the same document as `text/plain`.
 */
export async function extractDocument(deps: ExtractDeps, input: Document): Promise<Extracted> {
  if (input.bytes.byteLength === 0) {
    return refused(EMPTY_SOURCE);
  }

  const type = input.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const reader = READERS.get(type);
  return reader === undefined ? refused(UNSUPPORTED_TYPE) : await reader(deps, input);
}
