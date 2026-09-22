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
 * WHAT IS NOT HERE. No `--psm`, no character whitelist, no deskew, no rasterisation stage. The
 * sibling project at this company has a decade of tuning around those -- including a colour
 * crop that exists because grayscale OCR of one bank's receipt keeps the digits and erases the
 * currency code -- and every bit of it is about their documents, not ours. The generic
 * invocation is the measured first cut; anything past it is a change with its own numbers.
 */

import { type ExtractDeps, extractorMissing, runProgram } from "./program.ts";

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
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

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

  const ran = await runProgram(deps, ["tesseract", image.path, "stdout", "-l", LANGUAGES]);
  if (!ran.ok) {
    return { ok: false, reason: ran.missing ? extractorMissing("tesseract") : TESSERACT_FAILED };
  }

  // Whitespace only is what a blank page produces: tesseract prints the page's form feeds and
  // line breaks whether or not it recognised a glyph. Anything else is text a reader would
  // see, and it is stored -- the size gate above has already taken out the furniture, so there
  // is no second threshold here to tune, and a rule with no number cannot be tuned wrong.
  return ran.output.trim() === ""
    ? { ok: false, reason: OCR_FOUND_NOTHING }
    : { ok: true, text: ran.output };
}
