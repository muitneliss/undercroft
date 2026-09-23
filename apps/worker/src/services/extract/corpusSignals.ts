/**
 * Tier B's other half: what the extracted corpus looks like, counted.
 *
 * No ground truth and no human here either, but a weaker claim than the oracle's: these
 * signals say whether output is PLAUSIBLE, never whether it is RIGHT. Every count below is a
 * lead. `accuracy.ts` carries the four laws and `ooxmlOracle.ts` the strong figure.
 *
 * THE CROSS-METHOD REFERENCE IS WHAT THIS IS REALLY FOR, and it already produced a result
 * before any of this was written: the Vietnamese rate by method on production is `pdf_text`
 * 11%, `image_ocr` 10%, `xlsx` 18%, `pdf_ocr` 15%. Poppler's text layer needs no language
 * pack, so it is the control; had `tesseract-ocr-vie` been absent or ineffective the two OCR
 * rates would sit near zero beside an unchanged 11%. That is a real finding about a deployment
 * obtained from nothing but counts.
 *
 * WHAT LEAVES THIS MODULE IS COUNTS AND RATES. `CorpusRow` carries a customer's document text
 * IN, because the signals can only be computed over it; `CorpusReport` has no field that could
 * carry a character of it back OUT, and that is structural rather than a matter of care. The
 * text in that column is the one thing ADR 0024 lets into Postgres at all, and a report that
 * quoted an excerpt would move it somewhere `pii.md` does not cover. No document id either: an
 * id beside a defect count is a pointer at content.
 */

/**
 * One row of `raw.document_text`, joined to what the catalogue says its source weighed.
 *
 * `text` goes no further than this module's counters.
 */
export interface CorpusRow {
  readonly method: string | null;
  readonly reason: string | null;
  readonly truncated: boolean;
  /** `raw.documents.byte_length`: how big the thing we read FROM was. */
  readonly sourceBytes: number;
  readonly text: string;
}

/**
 * Vietnamese, told apart from French and Spanish.
 *
 * The Vietnamese extended block plus the six letters the language owns outright. A class that
 * merely meant "an accent" would fire on `café` and make the cross-method comparison say
 * nothing -- its whole point is that a Vietnamese language pack either worked or did not, and
 * an English-only OCR pass of a Vietnamese invoice returns confident English words rather than
 * accented ones (`ocr.ts`).
 */
const VIETNAMESE = /[\u1EA0-\u1EF9\u0102\u0103\u0110\u0111\u01A0\u01A1\u01AF\u01B0]/u;

/**
 * The garbage heuristic, at the sibling project's numbers.
 *
 * Twenty-five high-code-point non-letters inside the first 1,200 characters is what mojibake
 * and a failed OCR pass look like, and what ordinary Vietnamese does not: every accented
 * letter is a LETTER and scores nothing here. Applied to the 96 short OCR reads on production
 * it returns zero, mean 0.0, which is how we know those reads are small images holding a few
 * real words rather than noise -- and is why `ocr.ts` has no minimum-length refusal.
 */
const GARBAGE_WINDOW = 1200;
const GARBAGE_THRESHOLD = 25;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const HIGH_CODE_POINT = 0x80;

function looksLikeGarbage(text: string): boolean {
  let seen = 0;
  let at = 0;
  for (const character of text) {
    if (at >= GARBAGE_WINDOW) {
      break;
    }
    at += 1;
    if ((character.codePointAt(0) ?? 0) >= HIGH_CODE_POINT && !ALPHANUMERIC.test(character)) {
      seen += 1;
      if (seen >= GARBAGE_THRESHOLD) {
        return true;
      }
    }
  }
  return false;
}

/**
 * A source big enough that almost no text is the suspicious shape.
 *
 * 100 KB and 80 characters: a large picture holding one line of text is a scan that mostly
 * failed, where a small one holding the same line is a logo and is fine. THE RATIO IS THE
 * SIGNAL, not either number alone -- which is why this is a reported count here and not a
 * refusal in `ocr.ts`, where a bare length floor would have thrown away the 96 correct short
 * reads above.
 *
 * It named 17 images on production on 2026-09-22 and 21 an hour later, and the date is part
 * of the claim rather than decoration: this counts LIVE rows, so it moves as the extract
 * backlog drains. Every other measured figure in this codebase is over a fixed tree and
 * stays put. Do not "correct" this one against a fresh run -- re-date it, or take the count
 * out and leave the reasoning, which is the half that does not age.
 */
const LARGE_SOURCE_BYTES = 100 * 1024;
const TERSE_TEXT_CHARS = 80;

/**
 * The shape every refusal this codebase writes has, and the only shape that is echoed.
 *
 * `raw.document_text.reason` is a `text` column. Today every value in it is one of about
 * fourteen constants from `extractText.ts`, `ocr.ts`, `program.ts` and `runExtract.ts`, so a
 * report that printed the column back was safe by COINCIDENCE rather than by construction --
 * a suite caught exactly that, by putting a sentence in the column and finding it in the
 * output. A value is therefore echoed only if it looks like one of ours: lowercase words
 * joined by hyphens, optionally with a program name after a colon. A new reader's new constant
 * passes with no change here; a sentence somebody wrote cannot.
 *
 * Bucketed rather than dropped, because a reason nobody recognises is a fact worth a count --
 * it just is not a fact worth quoting.
 */
const REASON_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?::[A-Za-z0-9._-]+)?$/u;
export const UNRECOGNISED_REASON = "unrecognised-reason-shape";

/** `method` and `reason` both null, which the table's CHECK forbids. A defect if it appears. */
export const UNRECORDED_REASON = "no-method-and-no-reason";

function namedReason(reason: string | null): string {
  if (reason === null) {
    return UNRECORDED_REASON;
  }
  return REASON_SHAPE.test(reason) ? reason : UNRECOGNISED_REASON;
}

/** What one reader produced across the corpus. Every field is a count. */
export interface MethodTally {
  readonly method: string;
  readonly documents: number;
  /** Characters held, so the rates beside it rest on more than a document count. */
  readonly chars: number;
  /** Of `documents`, how many carry Vietnamese. The cross-method reference. */
  readonly vietnamese: number;
  readonly garbage: number;
  readonly truncated: number;
  /** Read, and yet holding nothing -- the silent zero this codebase refuses everywhere else. */
  readonly silentZero: number;
  /** Read from a large source, and yet holding almost nothing. */
  readonly terseForSize: number;
}

/** What was refused, and how often. */
export interface ReasonTally {
  /** One of our own named constants, or the two above. Never free text. */
  readonly reason: string;
  readonly documents: number;
}

export interface CorpusReport {
  readonly documents: number;
  /** Ordered by document count, so the reader the corpus leans on is first. */
  readonly methods: readonly MethodTally[];
  readonly reasons: readonly ReasonTally[];
}

/** A running tally. Mutable inside the loop below and frozen into a `MethodTally` after it. */
type Counts = { -readonly [K in keyof MethodTally as K extends "method" ? never : K]: number };

function countInto(counts: Counts, row: CorpusRow): void {
  const chars = [...row.text].length;
  counts.documents += 1;
  counts.chars += chars;
  counts.vietnamese += VIETNAMESE.test(row.text) ? 1 : 0;
  counts.garbage += looksLikeGarbage(row.text) ? 1 : 0;
  counts.truncated += row.truncated ? 1 : 0;
  counts.silentZero += chars === 0 ? 1 : 0;
  counts.terseForSize += row.sourceBytes >= LARGE_SOURCE_BYTES && chars < TERSE_TEXT_CHARS ? 1 : 0;
}

function emptyCounts(): Counts {
  return {
    documents: 0,
    chars: 0,
    vietnamese: 0,
    garbage: 0,
    truncated: 0,
    silentZero: 0,
    terseForSize: 0,
  };
}

/**
 * Count the corpus, one row at a time, keeping none of it.
 *
 * `Iterable` rather than an array so a caller can stream a page of rows at a time and let each
 * page go; a platform-wide read of `raw.document_text` is every contract every customer has.
 */
export function measureCorpus(rows: Iterable<CorpusRow>): CorpusReport {
  const methods = new Map<string, Counts>();
  const reasons = new Map<string, number>();
  let documents = 0;

  for (const row of rows) {
    documents += 1;
    if (row.method === null) {
      const reason = namedReason(row.reason);
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      continue;
    }
    const counts = methods.get(row.method) ?? emptyCounts();
    countInto(counts, row);
    methods.set(row.method, counts);
  }

  return {
    documents,
    methods: [...methods]
      .map(([method, counts]) => ({ method, ...counts }))
      .sort((a, b) => b.documents - a.documents || a.method.localeCompare(b.method)),
    reasons: [...reasons]
      .map(([reason, count]) => ({ reason, documents: count }))
      .sort((a, b) => b.documents - a.documents || a.reason.localeCompare(b.reason)),
  };
}
