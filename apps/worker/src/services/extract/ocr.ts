/**
 * What a picture of a document says, read by `tesseract`.
 *
 * MOST IMAGES ARE NOT DOCUMENTS, and that is the whole shape of this module. An email carries
 * far more logos and signature blocks than it carries photographed invoices, so the reader
 * decides whether these bytes are worth a child process BEFORE it starts one -- see
 * `OCR_MIN_IMAGE_BYTES`. A refusal by name is what comes back instead, because an operator
 * reading the ledger should see the decision rather than an absence.
 *
 * VIETNAMESE IS NOT A PREFERENCE. `-l vie+eng` is passed on every run, never `eng` alone: of
 * 409 documents read on production, 69 (17%) carry Vietnamese diacritics. English-only OCR of
 * a Vietnamese invoice does not fail -- it returns confident English-looking words that were
 * never on the page, which is `CLAUDE.md` rule 2's exact failure, arriving in a search index
 * looking like data. The Vietnamese pack is therefore pinned in `deploy/Dockerfile.worker`:
 * `which tesseract` answers "installed", it does not answer "can read Vietnamese", and two
 * machines with the same binary and different packs produce different text from one file.
 *
 * READ AND FOUND NOTHING IS NOT THE SAME FACT AS COULD NOT READ. Three refusals leave here and
 * each names something different: bytes too small to be a document, a program that is not
 * installed, a program that ran and failed -- and a fourth, `OCR_FOUND_NOTHING`, for an engine
 * that ran to completion over a page and came back empty. That last one is a verdict about
 * THIS ENGINE TODAY, not about the bytes: a language pack added, or a better engine, would
 * find something in the same file. It is kept distinct so it can be re-read when that changes;
 * folding it into "failed" would make the answer self-fulfilling.
 *
 * A SCAN IS THE SAME READER WITH A RASTERISER IN FRONT. `pdfPages.ts` turns a PDF into page
 * images because tesseract cannot open a PDF at all, and everything below treats those pages
 * as what they are: one document that happens to arrive in parts. The two entry points differ
 * in what they are handed, not in what they believe.
 *
 * WHAT IS NOT HERE. No `--psm`, no character whitelist, no deskew, no `ocrmypdf`. The sibling
 * project at this company has a decade of tuning around those -- including a colour crop that
 * exists because grayscale OCR of one bank's receipt keeps the digits and erases the currency
 * code -- and every bit of it is about their documents, not ours. The generic invocation is
 * the measured first cut; anything past it is a change with its own numbers.
 */

import {
  DEFAULT_EXTRACT_TIMEOUT_MS,
  type ExtractDeps,
  extractorMissing,
  runProgram,
} from "./program.ts";
import { withPageImages } from "./pdfPages.ts";

/**
 * Below this an image is furniture, not a document.
 *
 * Measured over the 1,557 images in the lake: 815 of them are under 20 KB and only about 97
 * are over 100 KB. The distribution is that bimodal because the small half is what email
 * carries by the thousand -- a logo, a signature block, a social icon in a footer -- and OCR
 * of one costs a child process to produce a fragment that makes full-text search worse.
 *
 * The exact boundary is therefore not delicate: it sits in the empty middle of a distribution
 * with two humps, and moving it by a kilobyte moves almost nothing. What it must not do is
 * drift toward either hump without a new measurement, which is what this docstring is for.
 */
export const OCR_MIN_IMAGE_BYTES = 20 * 1024;

/** The bytes are too small to be a document. A decision, so it is recorded as one. */
export const IMAGE_TOO_SMALL = "image-too-small-to-read";

/** The engine ran over the whole page and came back with nothing. See the note above. */
export const OCR_FOUND_NOTHING = "ocr-found-nothing";

/** The engine ran and exited non-zero: a fact about these bytes, not about the installation. */
export const TESSERACT_FAILED = "tesseract-failed";

/** Poppler could not turn this PDF into a page to read. See `pdfPages.ts`. */
export const PDFTOPPM_FAILED = "pdftoppm-failed";

/**
 * The document's whole deadline went before a single page was read.
 *
 * Distinct from `tesseract-failed` for the reason the module docstring gives: nothing about
 * these bytes has been established, so it is a verdict about a budget and not about a
 * document, and it must stay re-readable when the budget or the host changes.
 */
export const OCR_OUT_OF_TIME = "ocr-out-of-time";

/**
 * Between pages, matching `docx.ts`'s separator between parts. One document arrived in pieces;
 * nothing downstream should have to know which piece a sentence came from.
 */
const PAGE_SEPARATOR = "\n\n";

/**
 * Vietnamese first, then English, on every document -- see the module docstring for why this
 * is not a knob. Both packs are one download; the ordering is tesseract's hint about which
 * dictionary to prefer, not a restriction.
 */
const LANGUAGES = "vie+eng";

/**
 * Text, or the name of the reason there is none. Deliberately the shape `pdfTextLayer` already
 * returns: the caller turns it into a row, and nothing here knows what a row looks like.
 */
export type OcrOutcome =
  | { readonly ok: true; readonly text: string; readonly truncated: boolean }
  | { readonly ok: false; readonly reason: string };

/** One page's text, or the name of the reason the document cannot be read at all. */
type PageOutcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/** `tesseract <path> stdout -l vie+eng`: the one invocation, wherever the image came from. */
async function ocrPage(deps: ExtractDeps, path: string, timeoutMs: number): Promise<PageOutcome> {
  const ran = await runProgram({ ...deps, timeoutMs }, [
    "tesseract",
    path,
    "stdout",
    "-l",
    LANGUAGES,
  ]);
  if (ran.ok) {
    return { ok: true, text: ran.output };
  }
  return { ok: false, reason: ran.missing ? extractorMissing("tesseract") : TESSERACT_FAILED };
}

/** What OCR needs of a document: the bytes, to weigh, and where they are, to read. */
interface Image {
  readonly bytes: Uint8Array;
  readonly path: string;
}

/**
 * Read an image, or say why not.
 *
 * THE FILE ON DISK HAS NO EXTENSION -- `runExtract` writes `doc-<sanitised id>` -- and nothing
 * here may start depending on one. Tesseract sniffs the content through leptonica, so a PNG
 * named `doc-17a3` reads exactly as `doc-17a3.png` would.
 *
 * NO DEADLINE OF ITS OWN, deliberately. `runProgram` already carries the extractor's shared
 * five minutes, and this is one page through one process: seconds, with three orders of
 * magnitude of headroom. A tesseract run that reaches five minutes on a single image is hung,
 * not slow, and widening the shared deadline to accommodate it would quietly lengthen every
 * other reader's worst case too.
 */
export async function ocrImage(deps: ExtractDeps, image: Image): Promise<OcrOutcome> {
  if (image.bytes.byteLength < OCR_MIN_IMAGE_BYTES) {
    return { ok: false, reason: IMAGE_TOO_SMALL };
  }

  const page = await ocrPage(deps, image.path, deps.timeoutMs ?? DEFAULT_EXTRACT_TIMEOUT_MS);
  if (!page.ok) {
    return page;
  }

  // Whitespace only is what a blank page produces: tesseract prints the page's form feeds and
  // line breaks whether or not it recognised a glyph. Anything else is text a reader would
  // see, and it is stored -- the size gate above has already taken out the furniture, so there
  // is no second threshold here to tune, and a rule with no number cannot be tuned wrong.
  return page.text.trim() === ""
    ? { ok: false, reason: OCR_FOUND_NOTHING }
    : { ok: true, text: page.text, truncated: false };
}

/** What the engine got through before it was stopped, or the reason the document is refused. */
type ScanRead =
  | { readonly ok: true; readonly texts: readonly string[]; readonly outOfTime: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * Run the engine over a document's pages until they run out or the time does.
 *
 * A PAGE THAT FAILS FAILS THE DOCUMENT; only the TAIL may be dropped. Keeping the pages that
 * worked would store a contract with clause seven missing from the middle, which reads exactly
 * like a contract that never had one -- `docx.ts` refuses a part it cannot inflate for the
 * same reason. Running out of pages at the end is different in kind: the caller marks the text
 * `truncated` and a reader can see that. A hole cannot be said.
 *
 * A BLANK PAGE IS NOT A FAILURE. Scans are full of them -- separator sheets, the backs of
 * pages -- so one contributes nothing and the read continues.
 */
async function readPages(
  deps: ExtractDeps,
  paths: readonly string[],
  deadline: number,
  clock: () => number,
): Promise<ScanRead> {
  const texts: string[] = [];

  for (const path of paths) {
    const left = deadline - clock();
    if (left <= 0) {
      return { ok: true, texts, outOfTime: true };
    }
    const page = await ocrPage(deps, path, left);
    if (!page.ok) {
      return page;
    }
    if (page.text.trim() !== "") {
      texts.push(page.text);
    }
  }

  return { ok: true, texts, outOfTime: false };
}

/**
 * Read a scanned PDF: rasterise it, then OCR the pages as one document.
 *
 * THE DOCUMENT'S DEADLINE IS DIVIDED, NOT MULTIPLIED. `runProgram` applies `timeoutMs` to each
 * child, so a thirty-page scan handed the shared five minutes per child would be allowed two
 * and a half HOURS -- a reader quietly exempting itself from the limit every other reader
 * obeys. Instead the budget becomes a deadline at the moment this starts, and every child gets
 * what is left of it: rasterisation takes what it needs, each page takes what remains after
 * the pages before it, and the whole document is done inside one budget. Widening the shared
 * default to make this comfortable would have lengthened every other reader's worst case too.
 *
 * A document whose every page came back blank is `OCR_FOUND_NOTHING`, which is the image
 * reader's rule at document scale. `readPages` above carries the rest of the reasoning.
 */
export function ocrScan(deps: ExtractDeps, pdfPath: string): Promise<OcrOutcome> {
  const clock = deps.now ?? Date.now;
  const deadline = clock() + (deps.timeoutMs ?? DEFAULT_EXTRACT_TIMEOUT_MS);

  return withPageImages(deps, pdfPath, async (rendered): Promise<OcrOutcome> => {
    if (!rendered.ok) {
      return {
        ok: false,
        reason: rendered.missing ? extractorMissing("pdftoppm") : PDFTOPPM_FAILED,
      };
    }

    const pages = await readPages(deps, rendered.paths, deadline, clock);
    if (!pages.ok) {
      return pages;
    }

    // Nothing read at all. Which of the two it was matters: out of time says the budget ended
    // before this document got a verdict, where found-nothing says the engine gave it one.
    if (pages.texts.length === 0) {
      return { ok: false, reason: pages.outOfTime ? OCR_OUT_OF_TIME : OCR_FOUND_NOTHING };
    }

    return {
      ok: true,
      text: pages.texts.join(PAGE_SEPARATOR),
      truncated: rendered.truncated || pages.outOfTime,
    };
  });
}
