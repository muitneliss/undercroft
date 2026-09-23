/**
 * The corpus defect signals, each pinned from both sides.
 *
 * A signal with only its firing case is satisfied by a counter that always fires, and a
 * measurement whose counters always fire sends somebody to read customer documents for
 * nothing. So every one below has the shape it names AND the neighbouring shape it must stay
 * quiet on -- a large source against a small one, mojibake against ordinary Vietnamese,
 * Vietnamese against French.
 */

import { describe, expect, test as it } from "bun:test";

import {
  type CorpusRow,
  measureCorpus,
  type MethodTally,
  UNRECOGNISED_REASON,
  UNRECORDED_REASON,
} from "./corpusSignals.ts";

function read(over: Partial<CorpusRow> = {}): CorpusRow {
  return {
    method: "docx",
    reason: null,
    truncated: false,
    sourceBytes: 4096,
    text: "Schedule of fees for Acme Holdings Pte Ltd",
    ...over,
  };
}

/** The one method tally these rows produce. */
function tally(...rows: readonly CorpusRow[]): MethodTally {
  const [first] = measureCorpus(rows).methods;
  if (first === undefined) {
    throw new Error("these rows were expected to produce exactly one method tally");
  }
  return first;
}

describe("a read that produced nothing", () => {
  it("is counted, because a method with no characters is a claim about nothing", () => {
    // Two workbooks on production carry a method and no text. That is the silent zero this
    // codebase refuses everywhere else, arriving through the one door nothing was watching.
    expect(tally(read({ text: "" })).silentZero).toBe(1);
  });

  it("is not counted when the read produced characters", () => {
    expect(tally(read()).silentZero).toBe(0);
  });
});

describe("text that is short for the bytes it came from", () => {
  it("counts a large source that yielded almost nothing", () => {
    expect(tally(read({ sourceBytes: 250_000, text: "Acme" })).terseForSize).toBe(1);
  });

  it("does not count a SMALL source that yielded almost nothing", () => {
    // The ratio is the signal. A 4 KB image holding one word is a logo and is fine; a bare
    // length floor instead would have discarded 96 correct short reads on production.
    expect(tally(read({ sourceBytes: 4096, text: "Acme" })).terseForSize).toBe(0);
  });
});

describe("the garbage heuristic", () => {
  it("counts text that is mostly high-code-point punctuation", () => {
    expect(tally(read({ text: "¿¤§".repeat(20) })).garbage).toBe(1);
  });

  it("does not count ordinary Vietnamese", () => {
    // The property measured against the 96 short OCR reads, which returned zero: every
    // accented letter is a LETTER, so a rule keyed on non-letters cannot fire on it.
    const vietnamese = "Hợp đồng dịch vụ kế toán ký ngày mười bốn tháng ba".repeat(5);
    expect(tally(read({ text: vietnamese })).garbage).toBe(0);
  });

  it("looks only at the start, so a long clean document is not saved by its tail", () => {
    // And not saved by its length either: the window is what makes the threshold mean the
    // same thing for a one-line OCR read and a forty-page contract.
    const head = "¿¤§".repeat(20);
    expect(tally(read({ text: `${head}${"ordinary prose ".repeat(500)}` })).garbage).toBe(1);
  });
});

describe("the cross-method Vietnamese reference", () => {
  it("counts Vietnamese where it appears", () => {
    expect(tally(read({ text: "Phí dịch vụ kế toán" })).vietnamese).toBe(1);
  });

  it("does not count French or Spanish accents as Vietnamese", () => {
    // The comparison only says something if the class is the language's own. A rule that
    // meant "an accent" would fire on `café` and make every method look alike.
    expect(tally(read({ text: "Réunion au café, señor" })).vietnamese).toBe(0);
  });

  it("keeps the methods apart, which is what makes one of them a control", () => {
    const report = measureCorpus([
      read({ method: "pdf_text", text: "Phí dịch vụ" }),
      read({ method: "image_ocr", text: "plain ascii only" }),
    ]);
    expect(report.methods.map((one) => [one.method, one.vietnamese])).toEqual([
      ["image_ocr", 0],
      ["pdf_text", 1],
    ]);
  });
});

describe("refusals", () => {
  it("buckets a refusal by its reason instead of counting it as a method", () => {
    const report = measureCorpus([
      read({ method: null, reason: "legacy-doc-unsupported", text: "" }),
      read({ method: null, reason: "legacy-doc-unsupported", text: "" }),
      read(),
    ]);
    expect(report.documents).toBe(3);
    expect(report.methods).toHaveLength(1);
    expect(report.reasons).toEqual([{ reason: "legacy-doc-unsupported", documents: 2 }]);
  });

  it("echoes a reason that has the shape this codebase writes", () => {
    // The quiet half of the filter below. One that bucketed everything would hide the
    // extractor-missing and legacy-format counts that make the list worth printing at all.
    const report = measureCorpus([
      read({ method: null, reason: "extractor-missing:tesseract", text: "" }),
      read({ method: null, reason: "legacy-xls-unsupported", text: "" }),
    ]);
    expect(report.reasons.map((one) => one.reason)).toEqual([
      "extractor-missing:tesseract",
      "legacy-xls-unsupported",
    ]);
  });

  it("names a row that recorded neither a method nor a reason", () => {
    // The table's CHECK forbids it, so a count here is a defect upstream rather than a fact
    // about a document -- which is why it gets a name and not a blank.
    expect(measureCorpus([read({ method: null, reason: null, text: "" })]).reasons).toEqual([
      { reason: UNRECORDED_REASON, documents: 1 },
    ]);
  });
});

describe("what the report may carry", () => {
  it("carries no character of a document's text", () => {
    // The structural half of `pii.md` here, and this test is why `reason` is filtered at all:
    // it put a sentence in a free-text column and found it in the output.
    const secret = "Nguyen Van A agrees to pay 4,500.00 SGD";
    const report = measureCorpus([read({ text: secret }), read({ method: null, reason: secret })]);
    expect(JSON.stringify(report)).not.toContain("4,500.00");
    expect(JSON.stringify(report)).not.toContain("Nguyen");
    expect(report.reasons).toEqual([{ reason: UNRECOGNISED_REASON, documents: 1 }]);
  });
});
