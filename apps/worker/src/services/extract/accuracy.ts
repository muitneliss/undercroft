/**
 * Whether the readers are RIGHT, as opposed to whether they ran.
 *
 * ADR 0036 shipped a reader for every content type this lake holds and closed by admitting
 * what it had measured: coverage -- which types get read -- and nothing at all about
 * correctness. This module and its two neighbours are that second measurement, and the
 * discipline in them is taken from a sibling project at this company whose pipeline passed
 * every "we touched every file" gate while 61% of what it extracted was right and 11% of it
 * was invented. Coverage is not correctness, and a green suite is evidence of neither.
 *
 * FOUR OF THEIR LAWS BIND HERE, and each one shaped something below.
 *
 *   1. Measure before opening a human review queue. A queue fed by an unmeasured extractor
 *      spends a person's day confirming that the extractor is unmeasured.
 *
 *   2. A SAMPLE YOU TUNED ON IS BURNT. Its score is an upper bound, never an estimate. They
 *      scored 100% on their tuned sample and 85% held-out on the same code, and the gap is
 *      exactly what tuning on the sample bought. `docx.test.ts`, `xlsx.test.ts` and
 *      `ocr.test.ts` were written to BUILD those readers, so they are burnt for this purpose
 *      however green they are -- which is why `goldSet.ts` is authored separately, from
 *      different documents, with the expected text written before any reader saw it.
 *
 *   3. Rare cases need targeted sampling, every number is conditional on what it was taken
 *      over, and SAYING "THIS IS STILL UNMEASURED" IS PART OF THE MEASUREMENT rather than a
 *      failure of it. `UNMEASURED` below is not an apology; it is a result.
 *
 *   9. "The doc says it is fixed" is not "the code is fixed". Everything here runs the shipped
 *      readers. Nothing re-implements one, and a case that cannot reach the real reader is
 *      reported as unmeasured rather than scored against a stand-in.
 *
 * WHAT IS WHERE. This file holds the alignment primitive, tier A -- documents we authored,
 * scored against exact truth -- and the standing list of what none of it establishes.
 * `ooxmlOracle.ts` and `corpusSignals.ts` are tier B, which is everything that can be learned
 * from documents nobody labelled. The split is by knowledge: authoring a document and
 * counting a corpus have nothing in common but the primitive below.
 *
 * THE PRIMITIVE, AND WHY IT ERRS DOWNWARD. `align` walks the output once and counts how much
 * of the expected text survives into it, in order. It is a greedy forward match rather than a
 * true longest-common-subsequence, which costs a little and buys two things: it is linear, so
 * the same function serves a 300-character gold document and a 200 KB contract; and it can
 * only UNDER-count a match, never over-count it. So every fidelity and recall figure in these
 * three files is a LOWER bound on the truth. That direction is deliberate. An upper bound is
 * what a burnt sample already gives us, and a measurement that can flatter the code it
 * measures is the thing law 2 exists to warn about.
 */

import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Extracted } from "./extractText.ts";
import { normalizeText } from "./extractText.ts";
import { EXTRACTOR_MISSING, type ExtractDeps } from "./program.ts";

/**
 * Comparable form: composed, whitespace collapsed, ends trimmed.
 *
 * NFC IS NOT COSMETIC HERE. Vietnamese `ế` is one code point composed and three decomposed,
 * and a reader that hands back the decomposed form says exactly the same thing while scoring
 * a third of the characters against a composed expectation. Composing both sides first is what
 * makes a character count a count of characters a reader would see.
 *
 * The whitespace collapse is `normalizeText`'s, reused rather than restated: line and cell
 * structure is a reader's own convention -- `docx.ts` writes ` | ` between cells and `\n\n`
 * between parts -- and scoring it would measure the convention rather than the document.
 *
 * SHARED WITH THE ORACLE ON PURPOSE. Two normalisations would make tier A's number and tier
 * B's number incomparable while both looked like percentages.
 */
export function comparable(value: string): string {
  return normalizeText(value.normalize("NFC"));
}

/** What an alignment found. Both halves are reported: a rate with no denominator is not one. */
export interface Fidelity {
  /** Characters the document was authored to contain. THE DENOMINATOR. */
  readonly expected: number;
  /** Of those, how many survived into the output, in order. */
  readonly kept: number;
  /**
   * Characters in the output that the expected text does not account for.
   *
   * Read it as an UPPER bound on invention, not as a count of it: a reader's own separators
   * land here too, so a perfect `.docx` table read scores a handful of them for the pipes
   * between its cells. What it is good for is the shape the sibling project measured at 11%
   * -- an OCR pass confidently emitting words that were never on the page moves this number by
   * far more than punctuation does.
   */
  readonly added: number;
}

/**
 * How much of `expected` survives into `actual`, in order.
 *
 * Greedy and linear; see the module docstring for why erring downward is the point. The two
 * strings are compared by code point rather than by UTF-16 unit, so nothing here can score a
 * surrogate half.
 */
export function align(expected: string, actual: string): Fidelity {
  const wanted = [...comparable(expected)];
  const got = [...comparable(actual)];

  let kept = 0;
  let at = 0;
  for (const character of wanted) {
    while (at < got.length && got[at] !== character) {
      at += 1;
    }
    if (at >= got.length) {
      break;
    }
    at += 1;
    kept += 1;
  }

  return { expected: wanted.length, kept, added: got.length - kept };
}

/** The bytes of one gold document, and where they have been written for a binary to open. */
export interface GoldDocument {
  readonly bytes: Uint8Array;
  readonly path: string;
}

/**
 * One authored document, and the text it says.
 *
 * `read` NAMES THE SHIPPED READER THIS CASE EXERCISES rather than letting every case go
 * through the same door. Most cases pass their content type to `extractDocument` and so
 * measure the dispatch as well as the reader; the scanned-PDF case cannot, because a PDF whose
 * pages carry real glyphs necessarily carries a text layer too and would be routed to
 * `pdf_text` before OCR ever saw it. A flag would have said the same thing less clearly, and
 * would have put a branch in the scorer for one case.
 */
export interface GoldCase {
  /** Stable, and a safe filename: the scorer writes the bytes under it. Invented content only. */
  readonly id: string;
  /** What this document exists to prove. Printed beside its score. */
  readonly feature: string;
  readonly bytes: Uint8Array;
  /** Authored BEFORE any reader was run against it. Law 2. */
  readonly expected: string;
  readonly read: (deps: ExtractDeps, document: GoldDocument) => Promise<Extracted>;
}

/**
 * What one gold document scored, or why it could not be scored at all.
 *
 * THE THIRD STATE IS THE POINT. A machine with no `tesseract` is not a machine on which OCR
 * scored zero, and it is certainly not one on which OCR passed; the offline gate runs on
 * exactly such a machine by design. `unmeasured` keeps that document out of both the numerator
 * and the denominator, and the count of them is printed, which is law 3 in one field.
 *
 * A reader that ran and REFUSED a good document is measured, at zero. That is a result.
 */
export type GoldOutcome =
  | {
      readonly id: string;
      readonly feature: string;
      readonly measured: true;
      /** How it was read, or `null` where a reader that ran refused the document. */
      readonly method: string | null;
      readonly fidelity: Fidelity;
    }
  | {
      readonly id: string;
      readonly feature: string;
      readonly measured: false;
      readonly why: string;
    };

export interface GoldScore {
  readonly cases: readonly GoldOutcome[];
  /** Summed over MEASURED cases only. Characters authored -- the denominator of the score. */
  readonly expected: number;
  readonly kept: number;
  readonly added: number;
  readonly measured: number;
  readonly unmeasured: number;
}

/**
 * Score the shipped readers over an authored gold set.
 *
 * The bytes go to disk under `deps.workDir` because two of the readers are native programs
 * that open a path. The names are the case ids, which this repository authors and which are
 * therefore known-safe -- `runExtract` sanitises a provider's document id for the same step
 * and must, because a Gmail id carries a colon; nothing here takes a name from outside.
 */
export async function scoreGold(deps: ExtractDeps, cases: readonly GoldCase[]): Promise<GoldScore> {
  const outcomes: GoldOutcome[] = [];
  for (const one of cases) {
    outcomes.push(await scoreOne(deps, one));
  }

  const scored = outcomes.filter((outcome) => outcome.measured);
  function total(pick: (fidelity: Fidelity) => number): number {
    return scored.reduce(
      (sum, outcome) => sum + (outcome.measured ? pick(outcome.fidelity) : 0),
      0,
    );
  }

  return {
    cases: outcomes,
    expected: total((fidelity) => fidelity.expected),
    kept: total((fidelity) => fidelity.kept),
    added: total((fidelity) => fidelity.added),
    measured: scored.length,
    unmeasured: outcomes.length - scored.length,
  };
}

async function scoreOne(deps: ExtractDeps, one: GoldCase): Promise<GoldOutcome> {
  const path = join(deps.workDir, one.id);
  await writeFile(path, one.bytes);
  let extracted: Extracted;
  try {
    extracted = await one.read(deps, { bytes: one.bytes, path });
  } finally {
    await rm(path, { force: true });
  }

  const named = { id: one.id, feature: one.feature };
  if (extracted.reason?.startsWith(EXTRACTOR_MISSING) === true) {
    // Not a score of zero. This machine cannot answer the question at all.
    return { ...named, measured: false, why: extracted.reason };
  }
  return {
    ...named,
    measured: true,
    method: extracted.method,
    fidelity: align(one.expected, extracted.text),
  };
}

/** One thing this measurement does not answer, and why it cannot. */
export interface Gap {
  readonly what: string;
  readonly why: string;
}

/**
 * The gaps that are true of every run, printed every run.
 *
 * NOT AN APOLOGY AND NOT A TODO LIST. Law 3: a number is conditional on what it was taken
 * over, and the conditions have to travel with it or the next reader takes a tier A figure for
 * a statement about the corpus. The first entry is the one that matters most, because the
 * failure this corpus is most exposed to does not look like a failure: OCR without the
 * language pack returns clean, confident, wrong words, and every signal in tier B would call
 * that document fine.
 */
export const UNMEASURED: readonly Gap[] = [
  {
    what: "OCR fidelity on a real scan",
    why: "there is no labelled data, and producing some means a person reading customer documents. Tier A scores OCR over a rendered page, which is far cleaner than a photographed invoice, and tier B asks only whether output is plausible.",
  },
  {
    what: "OCR fidelity on Vietnamese, at any quality",
    why: "a gold page can only be rendered in the fonts poppler substitutes, and none of them holds a Vietnamese glyph -- measured: `pdftotext` reads `Hợp đồng` from the gold PDF exactly and the same file rasterised loses the accents. A score from that would be measuring the fixture. GARBAGE-FREE IS NOT ACCURATE: this is precisely where a missing language pack hides.",
  },
  {
    what: "whether a defect count is a defect",
    why: "a garbage or terse-for-size count is a lead. Confirming one means opening the document, which is the human queue law 1 says to measure before opening.",
  },
  {
    what: "anything about a part the zip container dropped",
    why: "the OOXML oracle reads members through the same `zip.ts` the readers do, so a member neither can inflate is invisible to both. The readers fail the whole document in that case rather than returning part of it, and `zip.ts`'s own suite is what pins that.",
  },
  {
    what: "text a reader adds that the document did not contain",
    why: "`added` is an upper bound only: a reader's cell and part separators land in it beside anything genuinely invented, and nothing here tells them apart.",
  },
];
