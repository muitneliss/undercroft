/**
 * What a document says, and how we came to read it.
 *
 * One function per way of reading, dispatched on the content type the catalogue recorded.
 * Every one of them answers with a `method` -- how the text was obtained -- or a `reason` why
 * it could not be, and NEVER with an empty string standing in for both. A document that says
 * nothing and a document nobody could open are different facts, and collapsing them is the
 * silent zero this codebase refuses everywhere else (`CLAUDE.md` rule 2, ADR 0024).
 *
 * THE BINARIES ARE INVOKED, NOT IMPORTED. `pdftotext` is poppler and `tesseract` is tesseract;
 * both are native programs that ship in the worker image, in exactly the category `CLAUDE.md`
 * already grants dbt -- "an invoked dependency in its own container". No Python enters this
 * repo's source to read a PDF, and none needs to.
 *
 * SPAWN IS INJECTED, for the reason `transform.ts` injects it: the offline gate runs with no
 * Docker, no network and no credentials, and therefore with no poppler either. A test passes
 * a spawn that answers as the binary would; the process passes one that runs it. The shape is
 * deliberately `transform.ts`'s, not a second one -- a second way to spawn a child is a second
 * place for a timeout to be forgotten.
 *
 * A MISSING BINARY IS A REFUSAL, NOT A CRASH. An image with no `tesseract` behind it is
 * recorded as `extractor-missing:tesseract` and the run stays green. The alternative -- failing
 * the run -- turns one absent package into "your documents did not extract", which is both
 * less true and less actionable than the name of the program to install.
 */

import type { Spawn, SpawnOptions } from "../transform.ts";
import { readXlsx } from "./xlsx.ts";

/** How the text was read. A new extractor is a new value; the column is deliberately not an enum. */
export type ExtractMethod = "pdf_text" | "pdf_ocr" | "docx" | "xlsx" | "image_ocr" | "txt";

/**
 * Why nothing could be read. Each names something an operator can act on.
 *
 * `extractor-missing:<program>` carries the program's name because that IS the fix: "install
 * poppler-utils" is a different afternoon from "the PDF is corrupt", and a bare "could not
 * read" makes them look identical.
 */
export const LEGACY_DOC = "legacy-doc-unsupported";
export const LEGACY_XLS = "legacy-xls-unsupported";
export const XLSX_UNREADABLE = "xlsx-unreadable";
export const UNSUPPORTED_TYPE = "unsupported-content-type";
export const EMPTY_SOURCE = "document-has-no-bytes";
export function extractorMissing(program: string): string {
  return `extractor-missing:${program}`;
}

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

export interface ExtractDeps {
  /** Injected in tests; the process passes one that runs the real program. */
  readonly spawn: Spawn;
  /** Where a document's bytes are written for a binary to open. One directory per document. */
  readonly workDir: string;
  /** Per-program wall clock. A 200-page scan is slow; a hung child must still end. */
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
}

/** Long enough for a large scan, short enough that a hung child does not hold the run open. */
export const DEFAULT_EXTRACT_TIMEOUT_MS = 5 * 60 * 1000;

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

/**
 * Run one program and hand back its stdout, or say it is not installed.
 *
 * `Bun.spawn` raises rather than exiting non-zero when the executable does not exist, so the
 * "not installed" case arrives as a thrown error and not as a status code. Both end here, and
 * both are told apart from "the program ran and failed" by the caller, which is why this
 * returns a tagged result instead of a string.
 */
async function runProgram(
  deps: ExtractDeps,
  cmd: readonly string[],
): Promise<{ ok: true; output: string } | { ok: false; missing: boolean }> {
  const options: SpawnOptions = {
    cwd: deps.workDir,
    env: deps.env ?? {},
    timeoutMs: deps.timeoutMs ?? DEFAULT_EXTRACT_TIMEOUT_MS,
  };
  try {
    const { exitCode, output } = await deps.spawn(cmd, options);
    return exitCode === 0 ? { ok: true, output } : { ok: false, missing: false };
  } catch {
    // A spawn that could not start at all. Treated as "the program is not here", which is
    // what it means in practice and what the operator can fix.
    return { ok: false, missing: true };
  }
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
  // Below the threshold this is a scan, and reading it needs OCR. Until that lands, the
  // document is refused BY NAME rather than stored as the handful of stray characters the
  // layer did return -- which would read downstream as a contract that says almost nothing.
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
  ["application/pdf", readPdf],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", readWorkbook],
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
