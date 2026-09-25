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

import { readDoc } from "./doc.ts";
import { readDocx } from "./docx.ts";
import { decodeHtmlBytes, htmlToText } from "./html.ts";
import { mimeToText } from "./mime.ts";
import { ocrImage, ocrScan } from "./ocr.ts";
import { claimsOpenAttestation, readOpenAttestation } from "./openAttestation.ts";
import { type ExtractDeps, extractorMissing, runProgram } from "./program.ts";
import { readXlsx } from "./xlsx.ts";

/** How the text was read. A new extractor is a new value; the column is deliberately not an enum. */
export type ExtractMethod =
  | "pdf_text"
  | "pdf_ocr"
  | "docx"
  | "doc"
  | "xlsx"
  | "image_ocr"
  | "txt"
  | "html"
  | "mime"
  | "openattestation";

/**
 * Why nothing could be read. Each names something an operator can act on.
 *
 * The OCR refusals are `ocr.ts`'s, named there beside the decisions that produce them.
 */
// Since ADR 0053, only a Word file from before Word 97, whose 8-bit text states no codepage.
export const LEGACY_DOC = "legacy-doc-unsupported";
export const LEGACY_XLS = "legacy-xls-unsupported";
export const XLSX_UNREADABLE = "xlsx-unreadable";
export const DOCX_UNREADABLE = "docx-unreadable";
export const DOC_UNREADABLE = "doc-unreadable";
/**
 * A `.doc` saved with a password. Its own name for the reason `PDF_PASSWORD_PROTECTED` has
 * one: the bytes are intact and need the sender's password, where an unreadable file is worth
 * a look.
 */
export const DOC_PASSWORD_PROTECTED = "doc-password-protected";
export const UNSUPPORTED_TYPE = "unsupported-content-type";
export const EMPTY_SOURCE = "document-has-no-bytes";
export const PDF_TEXT_FAILED = "pdftotext-failed";
/**
 * A PDF locked with an open password. Told apart from `PDF_TEXT_FAILED` because the two send a
 * reader to different places: a corrupt file is worth a look, a locked one is intact in the
 * lake and needs the sender's password -- and until this had its own name, six locked email
 * attachments on production were reported as possibly corrupt.
 */
export const PDF_PASSWORD_PROTECTED = "pdf-password-protected";

/**
 * What poppler prints when a PDF will not open without a password; `pdftotext` exits 1 for
 * this and for a corrupt file alike, so the diagnostic is the only thing that tells them apart.
 * Should poppler ever reword it the refusal falls back to `pdftotext-failed` -- less specific,
 * never wrong.
 */
const POPPLER_PASSWORD_DIAGNOSTIC = "Incorrect password";

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
 * WHICH READER A PDF GOES TO, and nothing else. It is not a quality bar.
 *
 * Below 80 normalised characters the text layer is not believed and the pages are rasterised
 * and OCR'd instead. The number matters in one direction only: a scanned PDF still carries a
 * few stray characters from a header or a stamp, so "the layer returned something" is not
 * "the layer worked". Eighty is comfortably more than that noise and comfortably less than a
 * page of real text; it is the reference implementation's figure.
 *
 * OCR HAS NO SUCH FLOOR AND MUST NOT GROW ONE. The two paths look inconsistent -- 96 of the
 * 197 OCR'd images on production hold less text than this, and a reader who takes 80 for a
 * quality bar will reach for it -- so the difference is written here rather than left to be
 * "harmonised" later. A routing threshold asks "is there a better reader for this?", and for
 * a PDF there is: `pdf_ocr` reads the same document a second way. For an image there is no
 * second way, so the identical number would mean REFUSE, which is a different decision
 * entirely and one the data refuses. Applying the garbage heuristic in `corpusSignals.ts` to
 * those 96 rows returns zero, mean 0.0: they are clean text from small images that genuinely
 * hold a few real words, and an 80-character floor on OCR would throw away 96 correct
 * readings -- a loss dressed as a fix. `ocr.ts` gates on SOURCE BYTES instead, before it
 * spends a child process, which is the question an image can actually answer.
 *
 * What the data DOES support is a signal rather than a refusal: `terseForSize` in
 * `corpusSignals.ts` counts a source big enough that almost no text is the suspicious shape.
 * It is a lead and stays one. The count and the argument live there, in the module that
 * measures it, rather than being restated here where nothing would keep the two in step.
 *
 * ADR 0040.
 */
export const TEXT_LAYER_ROUTING_CHARS = 80;

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
 * The text as a reader found it, cut to the ceiling and made storable.
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
 *
 * `cutShort` is a reader saying the text it hands over is not the whole document -- a scan
 * stopped at the page cap, say. It joins the ceiling below into one flag because downstream
 * the question is the same one: is this all of it? WHY it is short is the reader's business;
 * THAT it is short is the document's.
 */
function read(method: ExtractMethod, raw: string, cutShort = false): Extracted {
  const { text, truncated } = capped(raw.replaceAll(NUL, NOT_TEXT));
  return { method, reason: null, text, truncated: truncated || cutShort };
}

function refused(reason: string): Extracted {
  return { method: null, reason, text: "", truncated: false };
}

/** Poppler's text layer, straight to stdout. `-layout` keeps columns in reading order. */
export async function pdfTextLayer(
  deps: ExtractDeps,
  path: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const result = await runProgram(deps, ["pdftotext", "-layout", path, "-"]);
  if (result.ok) {
    return { ok: true, text: result.output };
  }
  if (result.missing) {
    return { ok: false, reason: extractorMissing("pdftotext") };
  }
  return {
    ok: false,
    reason: result.output.includes(POPPLER_PASSWORD_DIAGNOSTIC)
      ? PDF_PASSWORD_PROTECTED
      : PDF_TEXT_FAILED,
  };
}

/** What every reader below is handed. `bytes` is what the lake holds; `path` is where they are. */
interface Document {
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly path: string;
}

type Reader = (deps: ExtractDeps, input: Document) => Extracted | Promise<Extracted>;

/**
 * A file that names no charset, as text: UTF-16 when a byte-order mark says so, UTF-8 otherwise.
 *
 * THE MARK IS THE FILE STATING ITS ENCODING, NOT A GUESS AT IT. Excel's "Unicode Text" export
 * and many a bank's statement are UTF-16 behind `FF FE`, and read as UTF-8 every other byte of
 * them is a NUL -- issue #218's likeliest source. These are the marks the WHATWG Encoding
 * Standard's `decode` sniffs, so this reads the file the way a browser opening it would. A UTF-16
 * file WITHOUT a mark is read as UTF-8 like everything else unlabelled: telling it apart would
 * mean weighing how many bytes look like zeros, which is a guess, and its NULs then arrive as
 * U+FFFD (`read`) -- visibly wrong rather than plausibly right. The decoder drops the mark
 * itself, as it drops UTF-8's.
 *
 * Non-fatal either way, so a stray byte in an otherwise readable file costs that byte and not
 * the document. What cannot be decoded at all lands as the replacement character, which is
 * visibly wrong rather than invisibly absent.
 */
function decodeUnlabelled(bytes: Uint8Array): string {
  return new TextDecoder(markedEncoding(bytes), { fatal: false }).decode(bytes);
}

/** The encoding a leading byte-order mark states, or UTF-8 when there is none. */
function markedEncoding(bytes: Uint8Array): "utf-16le" | "utf-16be" | "utf-8" {
  const [first, second] = bytes;
  if (first === 0xff && second === 0xfe) {
    return "utf-16le";
  }
  if (first === 0xfe && second === 0xff) {
    return "utf-16be";
  }
  return "utf-8";
}

function readPlainText(_deps: ExtractDeps, input: Document): Extracted {
  return read("txt", decodeUnlabelled(input.bytes));
}

async function readPdf(deps: ExtractDeps, input: Document): Promise<Extracted> {
  const layer = await pdfTextLayer(deps, input.path);
  if (!layer.ok) {
    return refused(layer.reason);
  }
  if (normalizeText(layer.text).length >= TEXT_LAYER_ROUTING_CHARS) {
    return read("pdf_text", layer.text);
  }
  // Below the threshold this is a scan: the handful of stray characters a stamp left in the
  // text layer is not what the document says, and storing it would read downstream as a
  // contract that says almost nothing. So the pages are rasterised and OCR'd instead -- this
  // is a ROUTING decision, and the alternative reader is what makes it one.
  //
  // THE RASTERISATION IS NOT OPTIONAL and is why this is two programs rather than one:
  // tesseract's input is an image, so `tesseract scan.pdf stdout` answers "Pdf reading is not
  // supported" and exits 1. `ocr.ts` owns the sequence, `pdfPages.ts` owns poppler; what this
  // layer decides is only that a scan is what we are looking at.
  const scan = await ocrScan(deps, input.path);
  return scan.ok ? read("pdf_ocr", scan.text, scan.truncated) : refused(scan.reason);
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
 * Read in process too, with no binary: `cfb.ts` opens the container and `doc.ts` argues why
 * the text of a Word 97 file is the one part of the format simple enough to read exactly.
 */
function readLegacyWord(_deps: ExtractDeps, input: Document): Extracted {
  const document = readDoc(input.bytes);
  if (document.ok) {
    return read("doc", document.text);
  }
  const reasons = {
    word95: LEGACY_DOC,
    encrypted: DOC_PASSWORD_PROTECTED,
    unreadable: DOC_UNREADABLE,
  } as const;
  return refused(reasons[document.why]);
}

/** A web page's text nodes, in the charset the page declares. `html.ts`. */
function readHtml(_deps: ExtractDeps, input: Document): Extracted {
  return read("html", htmlToText(decodeHtmlBytes(input.bytes)));
}

/** A saved email or a saved web page: one MIME tree, walked by `mime.ts`. */
function readMime(_deps: ExtractDeps, input: Document): Extracted {
  return read("mime", mimeToText(input.bytes));
}

/**
 * JSON is text, and is stored as the text it is -- except a document that claims to be
 * OpenAttestation, which is verified before a word of it is believed (`openAttestation.ts`).
 *
 * `JSON.parse` here only asks what the document claims to be; no number it produces is ever
 * read, so the lossless parser the money rule prefers would buy nothing. The verifier needs
 * the plain value, and an OpenAttestation v2 document carries every value as a string anyway.
 * A file that is not JSON at all is still text, and is kept as text.
 */
async function readJson(deps: ExtractDeps, input: Document): Promise<Extracted> {
  const text = decodeUnlabelled(input.bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return read("txt", text);
  }
  if (!claimsOpenAttestation(parsed)) {
    return read("txt", text);
  }
  const document = await readOpenAttestation(deps.openAttestation ?? {}, parsed);
  return document.ok ? read("openattestation", document.text) : refused(document.reason);
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
  return ocr.ok ? read("image_ocr", ocr.text, ocr.truncated) : refused(ocr.reason);
}

/**
 * One reader per content type. A NEW EXTRACTOR IS A NEW ENTRY, which is the shape this table
 * exists for: the chain of `if (type === ...)` it replaced grew a branch per format until it
 * was the most complex function in the module, and the cost of the next one was a re-read of
 * all of them.
 *
 * The `refused` entry is a reader too, deliberately. A format we have decided not to
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
  // Markdown and XML are read as the text they are. For XML that is the point rather than a
  // shortcut: an XBRL filing's element names -- `ifrs-full:Revenue` -- ARE its meaning, and
  // stripping the tags to leave the numbers would keep the figures and lose what they are.
  ["text/markdown", readPlainText],
  ["text/x-markdown", readPlainText],
  ["application/xml", readPlainText],
  ["text/xml", readPlainText],
  ["application/json", readJson],
  ["text/html", readHtml],
  ["message/rfc822", readMime],
  ["multipart/related", readMime],
  ["application/pdf", readPdf],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", readWorkbook],
  // A macro-enabled workbook is the same OOXML package with one more part, which is never
  // run: the reader opens the sheets' XML and nothing else. Lowercase, as the lookup is.
  ["application/vnd.ms-excel.sheet.macroenabled.12", readWorkbook],
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
  // tesseract opens WebP through leptonica, and Debian's leptonica -- the one the worker image
  // installs with tesseract -- is built with WebP. Where it is not, tesseract exits non-zero
  // and the refusal is `tesseract-failed`, by name.
  ["image/webp", readImage],
  // The pre-2007 binary workbook, refused by name so it is visible in the ledger rather than
  // absent from it. Its container is the one `cfb.ts` now opens for Word, but BIFF's cell
  // records are a second format entirely, and no reader for them has been written. Its own
  // reason rather than `LEGACY_DOC`, because an operator reading the ledger should not have
  // to know that the Word reason was meant to cover spreadsheets too.
  ["application/vnd.ms-excel", (): Extracted => refused(LEGACY_XLS)],
  // The pre-2007 binary Word format. Only a file older than Word 97 is still refused, as
  // `LEGACY_DOC`; ADR 0053.
  ["application/msword", readLegacyWord],
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
 * Generation 1 was the docx, csv and image readers arriving: `0` is what every row written
 * before the column existed carries, and it sorts below anything we bump to, so those rows
 * re-entered the queue exactly once.
 *
 * GENERATION 2 IS THE SCANNED-PDF READER. It is what re-offers the 53 documents recorded
 * `needs-ocr` -- a refusal whose whole point was that it would stop being true, and this is the
 * release where it stops. Without the bump `pdf_ocr` would ship reaching nothing at all: every
 * document it was written for already has a row, with bytes that have not moved.
 *
 * GENERATION 3 IS ISSUE #176's FORMATS: macro-enabled workbooks, HTML, saved pages and emails,
 * XML, JSON, Markdown, WebP, and OpenAttestation documents inside JSON. Each was recorded
 * `unsupported-content-type` until now, which is a refusal whose whole point is that it stops
 * being true.
 *
 * GENERATION 4 IS THE PASSWORD-PROTECTED PDF getting its own name. It re-offers the documents
 * recorded `pdftotext-failed` so a locked one is relabelled `pdf-password-protected` instead of
 * staying "possibly corrupt"; a genuinely broken one fails again and keeps its old reason.
 *
 * GENERATION 5 IS THE LEGACY WORD READER. Every `.doc` was recorded `legacy-doc-unsupported`,
 * a refusal whose whole point is that it stops being true; the bump re-offers them, and only a
 * file older than Word 97 comes back with the same reason.
 *
 * NOT BUMPED FOR ISSUE #218's UTF-16 DECODE AND NUL REPLACEMENT, and that is the rule working
 * rather than an oversight. A bump re-offers refusals, and neither change turns a refusal into a
 * reading: the documents they were written for never got a row at all -- their NUL failed the
 * write that carried them -- so they are still in the backlog, rowless, and the next run reads
 * them with no bump. Bumping would re-read every refusal on production to change none of them.
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
export const CURRENT_READER_VERSION = 5;

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
