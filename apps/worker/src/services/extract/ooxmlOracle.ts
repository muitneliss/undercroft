/**
 * Tier B's oracle: what an OOXML document says it holds, read independently of the reader.
 *
 * THE STRONGEST THING IN THE MEASUREMENT, and the reason is that OOXML carries its own answer.
 * Every `<w:t>` in a Word part IS text the document shows, so sweeping them says what the
 * output should have contained -- a recall figure over real customer documents that nobody had
 * to label, and that no human has to read. A reader that drops a part scores below 1.
 *
 * `accuracy.ts` carries the four laws this whole exercise follows and the alignment primitive
 * shared with tier A.
 *
 * A RUN AT A TIME, AND NOT THE CONCATENATION OF THEM. That is the whole of the design and both
 * halves of it were found by running it, not by reasoning about it. Concatenating the runs and
 * aligning the result IN ORDER fails on Word, because Word splits a run wherever a revision id
 * lands: `Acme Hold` and `ings Pte Ltd` are adjacent runs whose correct output is
 * `Acme Holdings`, and an oracle that put a separator between them scored a CORRECT reader at
 * 11%. Aligning in order fails on workbooks for a different reason: `xl/sharedStrings.xml`
 * declares its strings in TABLE order while the output shows them in CELL order, which scored
 * another correct read at 82%. Asking instead whether each run appears ANYWHERE in the output
 * answers both, because a run is the unit the format itself treats as atomic.
 *
 * What that gives up is the ability to notice reordering, which is a reader's own convention
 * here and deliberately not scored (`goldSet.ts`).
 *
 * THE WORD FIGURE IS THE STRONG ONE. The workbook figure is a LEAD RATHER THAN A VERDICT and
 * is kept apart so nobody averages them: `xl/sharedStrings.xml` declares every string the
 * workbook ever held, and Excel does not always prune the entries no cell still references, so
 * a perfectly correct read of a pruned-late workbook scores below 1 for a string that is not
 * on any sheet. Resolving that would mean re-implementing the reader's own cell lookup inside
 * the oracle, which is the one thing an oracle may not do.
 *
 * WHAT IT SHARES WITH THE READER, and therefore cannot check: the zip container and the XML
 * entity decoder. A member `zip.ts` cannot inflate is invisible to both, so this cannot report
 * a part the container dropped -- `docx.ts` and `xlsx.ts` fail the WHOLE read in that case,
 * which is the property that makes the gap survivable, and `zip.ts`'s own suite is what pins
 * it. Writing a second zip parser here would put a likelier bug in the oracle than the one it
 * was watching for. `UNMEASURED` says so out loud.
 */

import { comparable } from "./accuracy.ts";
import { decodeXmlText } from "./xlsx.ts";
import { readZipIndex, readZipText } from "./zip.ts";

/** Which container this is. The two are reported separately and never averaged; see above. */
export type OoxmlKind = "word" | "workbook";

/** What one document declared, and how much of it the reader produced. */
export interface OoxmlRecall {
  readonly kind: OoxmlKind;
  /** Characters the parts declare, summed over the runs below. THE DENOMINATOR. */
  readonly declared: number;
  /** Of those, how many belong to a run that appears in the extracted text. */
  readonly found: number;
  /** Text runs declared, so a rate rests on more than a character count. */
  readonly runs: number;
  /** XML parts swept. A reader that ignores a whole part is what this catches. */
  readonly parts: number;
}

/** Word's text runs, and the shared and inline strings a workbook keeps in the same shape. */
const WORD_TEXT = /<w:t\b[^>]*?(?:\/>|>(?<body>[\s\S]*?)<\/w:t>)/gu;
const SHEET_TEXT = /<t\b[^>]*?(?:\/>|>(?<body>[\s\S]*?)<\/t>)/gu;

/**
 * Phonetic guide runs, excluded from what a part DECLARES.
 *
 * Deliberately this module's own judgement and not a constant borrowed from `xlsx.ts`, even
 * though the two say the same thing. An oracle that imported the reader's list of things to
 * skip could never catch the reader skipping too much -- it would agree with it by
 * construction. Two independent readings of the same format specification is what makes this
 * an oracle at all; the cost is that they must be changed together when the spec is wrong, and
 * the benefit is that they disagree when one of them is.
 */
const PHONETIC_GUIDE = /<rPh\b[\s\S]*?<\/rPh>/gu;

const WORD_BODY = "word/document.xml";
const WORKSHEET = /^xl\/worksheets\/sheet\d+\.xml$/u;
const XML_PART = /\.xml$/u;

function kindOf(names: readonly string[]): OoxmlKind | null {
  if (names.includes(WORD_BODY)) {
    return "word";
  }
  return names.some((name) => WORKSHEET.test(name)) ? "workbook" : null;
}

/**
 * Recall of one real document's own declared text, with no ground truth and no human.
 *
 * `null` for bytes that are not an OOXML document at all. The oracle has no opinion about a
 * PDF, and saying so is not the same as scoring it.
 */
export function ooxmlRecall(bytes: Uint8Array, extracted: string): OoxmlRecall | null {
  const index = readZipIndex(bytes);
  const names = [...index.keys()];
  const kind = kindOf(names);
  if (kind === null) {
    return null;
  }

  const haystack = comparable(extracted);
  let declared = 0;
  let found = 0;
  let runs = 0;
  let parts = 0;

  for (const name of names) {
    const xml = XML_PART.test(name) ? readZipText(bytes, index, name) : null;
    if (xml === null) {
      continue;
    }
    parts += 1;
    for (const run of declaredRuns(xml)) {
      runs += 1;
      declared += [...run].length;
      if (haystack.includes(run)) {
        found += [...run].length;
      }
    }
  }

  return { kind, declared, found, runs, parts };
}

/**
 * Every text run one part declares, entities resolved and in comparable form.
 *
 * A run that is empty or nothing but whitespace is dropped rather than counted as found: a
 * `<w:t xml:space="preserve"> </w:t>` is a space a reader is free to collapse, and counting it
 * would put a free match into every document's numerator.
 */
function declaredRuns(xml: string): string[] {
  const without = xml.replaceAll(PHONETIC_GUIDE, "");
  const runs: string[] = [];
  for (const pattern of [WORD_TEXT, SHEET_TEXT]) {
    for (const run of without.matchAll(pattern)) {
      const text = comparable(decodeXmlText(run.groups?.body ?? ""));
      if (text !== "") {
        runs.push(text);
      }
    }
  }
  return runs;
}

/** What the oracle found across many documents of one container kind. */
export interface OoxmlAudit {
  readonly kind: OoxmlKind;
  readonly documents: number;
  /** Characters declared across them. THE DENOMINATOR. */
  readonly declared: number;
  readonly found: number;
  /** Documents that scored below 1. For Word a defect; for a workbook, a lead. */
  readonly short: number;
}

export interface RecallSummary {
  /** One entry per container kind present. The two are never averaged; see above. */
  readonly byKind: readonly OoxmlAudit[];
  /** Documents the oracle had no opinion about: not OOXML, or a container it could not open. */
  readonly unscored: number;
}

/**
 * Total the oracle over a sample.
 *
 * Takes the results rather than the documents, so nothing about fetching bytes from an object
 * store reaches this module -- which is what lets the whole of tier B be exercised offline
 * against authored fixtures while the composition root does the part that needs credentials.
 */
export function summariseRecall(results: Iterable<OoxmlRecall | null>): RecallSummary {
  const byKind = new Map<OoxmlKind, OoxmlAudit>();
  let unscored = 0;

  for (const result of results) {
    if (result === null) {
      unscored += 1;
      continue;
    }
    const seen = byKind.get(result.kind);
    byKind.set(result.kind, {
      kind: result.kind,
      documents: (seen?.documents ?? 0) + 1,
      declared: (seen?.declared ?? 0) + result.declared,
      found: (seen?.found ?? 0) + result.found,
      short: (seen?.short ?? 0) + (result.found < result.declared ? 1 : 0),
    });
  }

  return { byKind: [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind)), unscored };
}
