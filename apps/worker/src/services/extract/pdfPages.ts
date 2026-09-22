/**
 * A scanned PDF as page images, because that is the only form an OCR engine can read.
 *
 * TESSERACT DOES NOT TAKE A PDF. Measured, not assumed: `tesseract scan.pdf stdout` answers
 * "Pdf reading is not supported" through leptonica and exits 1. So a `pdf_ocr` reader is two
 * programs, not one, and this module is the first -- poppler's `pdftoppm`, already in the
 * worker image for `pdftotext`, which means this reader costs no new package.
 *
 * THE PAGE NUMBERS ARE NOT GUESSABLE, and a reader that constructs them is broken in a way
 * that only shows on long documents. `pdftoppm` zero-pads the number to the width of the
 * DOCUMENT'S page count, not of the range asked for -- measured: a 9-page file writes
 * `x-1.png`, a 12-page file `x-01.png`, a 120-page file `x-001.png`. A reader expecting `-1`
 * therefore finds every page of a short scan and NOTHING of a long one, which reads downstream
 * as an empty document rather than as a bug. The directory is listed instead, and that is not
 * an implementation detail to tidy away later.
 *
 * NOTHING BINARY CROSSES THE SPAWN SEAM. `Spawn` returns stdout as a string, so `-png ... -`
 * would hand us a PNG through UTF-16 and back -- mojibake, the same hazard `connectors.md`
 * records for binary payloads. The pages go to disk and tesseract opens them by name.
 *
 * WHAT IT WRITES, IT REMOVES. A 30-page scan is tens of megabytes of transient PNGs beside a
 * document that is itself already on disk; `withPageImages` is the `try`/`finally` that makes
 * forgetting impossible, in the shape `withBytesOnDisk` established one module up. The cleanup
 * covers the pages a KILLED `pdftoppm` left behind too, which is why the listing happens
 * before the failure is returned rather than after it.
 */

import { readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { type ExtractDeps, runProgram } from "./program.ts";

/**
 * How many pages of one document are worth reading. Chosen, and the cost is why.
 *
 * OCR is seconds per page and the budget for a whole document is five minutes, so the cap and
 * the deadline are one decision: thirty pages is what fits with room to spare on a host slower
 * than the one this was measured on, where 200 pages could not fit at any resolution. It is
 * also the sibling project's figure over the same kind of Vietnamese scans, which is the only
 * empirical anchor either of us has.
 *
 * HITTING IT IS REPORTED, never silent. A document cut here comes back with `truncated` set,
 * which `raw.document_text` already carries and which an operator can select on. The honest
 * alternative -- refusing a 200-page scan outright -- stores nothing where this stores the
 * first thirty pages and says so, and a contract's operative terms are not usually on page 87.
 *
 * WHAT IT COSTS is worth stating: a truncated row has a `method`, and the retry mechanism
 * deliberately re-queues only rows with a `reason`, so RAISING THIS CAP WILL NOT RE-READ the
 * documents it already cut. They must be re-queued by hand. That asymmetry is the price of the
 * rule that stops a cheap re-run overwriting an expensive one.
 */
export const OCR_PAGE_CAP = 30;

/**
 * 150 DPI, which is also `pdftoppm`'s default -- passed explicitly so that poppler changing
 * its default cannot quietly change what our OCR reads.
 *
 * Measured rather than inherited, against an invented Vietnamese invoice at 10pt rendered to
 * A4 and OCR'd with the exact command this reader issues: at 150 DPI all 38 distinct accented
 * letters survived and the text matched the source 100%. 200, 300 and 400 DPI each scored
 * slightly WORSE (99.8%, 99.5%, 99.0%) while costing 1.4x to 2.6x the bytes and time. That
 * kills the argument for going higher -- which was that a Vietnamese diacritic is only a few
 * pixels at 150 and `má` misread as `ma` is a different word -- for rendered text at least.
 *
 * It does not settle it for a NOISY scan, which is what these 53 documents actually are, and
 * no measurement here can: we have no ground truth for them. What the number above buys is
 * that the resolution is not the first thing to suspect.
 *
 * `-gray` is deliberately NOT passed. It was measured on the same page and bought exactly
 * nothing -- identical PNG bytes, identical text -- while the sibling project has a recorded
 * incident of grayscale erasing a currency code that was legible in colour. Tesseract
 * binarises internally anyway, so the conversion can only discard a contrast it might have
 * used. A flag that measurably buys nothing is not a flag worth its risk.
 */
const RENDER_DPI = 150;

/** What the page images are called, under the document's own path. */
const PAGE_MARK = "-page";
const PAGE_EXTENSION = ".png";

/**
 * Page images, in order -- or the reason there are none.
 *
 * `paths` is never empty when `ok`: a PDF that poppler accepted and rendered nothing from is
 * reported as a failure, because "we have no page to read" is one fact however it arose.
 */
export type Rendered =
  | { readonly ok: true; readonly paths: readonly string[]; readonly truncated: boolean }
  | { readonly ok: false; readonly missing: boolean };

/**
 * The pages `pdftoppm` actually wrote for this prefix, ordered by page number.
 *
 * Listed rather than constructed -- see the module docstring -- and the number is parsed out
 * of each name rather than trusted to sort, so a change in poppler's padding cannot silently
 * reorder a document. An unlistable directory answers "no pages" rather than raising: this
 * runs inside a reader whose whole contract is to return a reason instead of ending the run.
 */
async function pagesAt(prefix: string): Promise<string[]> {
  const directory = dirname(prefix);
  const marker = `${basename(prefix)}-`;

  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }

  const pages: { at: number; path: string }[] = [];
  for (const name of names) {
    if (name.startsWith(marker) && name.endsWith(PAGE_EXTENSION)) {
      // A page index, not a quantity of anything -- `Number.parseInt` is the spelling
      // `money.md` leaves alone for exactly this.
      const at = Number.parseInt(name.slice(marker.length, -PAGE_EXTENSION.length), 10);
      if (!Number.isNaN(at)) {
        pages.push({ at, path: join(directory, name) });
      }
    }
  }

  return pages.sort((a, b) => a.at - b.at).map((page) => page.path);
}

/**
 * Render a PDF's pages, hand them to `use`, and delete them however that ends.
 *
 * ONE PAGE MORE THAN THE CAP IS RENDERED, and that extra image is how this knows whether there
 * were more pages than it may read. It is never OCR'd -- it is evidence, not content, and it
 * is deleted with the rest. Asking `pdfinfo` first would answer the same question with another
 * binary, another failure branch and a human-readable output to parse; one throwaway page of
 * rasterisation is cheaper than all three, and only documents that exceed the cap pay it.
 */
export async function withPageImages<T>(
  deps: ExtractDeps,
  pdfPath: string,
  use: (rendered: Rendered) => Promise<T>,
): Promise<T> {
  const prefix = `${pdfPath}${PAGE_MARK}`;
  const ran = await runProgram(deps, [
    "pdftoppm",
    "-png",
    "-r",
    String(RENDER_DPI),
    "-l",
    String(OCR_PAGE_CAP + 1),
    pdfPath,
    prefix,
  ]);

  // Listed BEFORE the failure is answered, so that a `pdftoppm` killed by its deadline has the
  // half-document it wrote cleaned up rather than left in the scratch directory.
  const written = await pagesAt(prefix);
  try {
    if (!ran.ok) {
      return await use({ ok: false, missing: ran.missing });
    }
    if (written.length === 0) {
      // Exit zero and no images: a PDF poppler could open and get no page out of. It is the
      // same fact as a non-zero exit -- there is nothing here to read -- and the caller names
      // it the same way rather than growing a reason for a distinction nobody can act on.
      return await use({ ok: false, missing: false });
    }
    return await use({
      ok: true,
      paths: written.slice(0, OCR_PAGE_CAP),
      truncated: written.length > OCR_PAGE_CAP,
    });
  } finally {
    await Promise.all(written.map((path) => rm(path, { force: true })));
  }
}
