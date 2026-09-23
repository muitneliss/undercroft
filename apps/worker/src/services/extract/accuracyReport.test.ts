/**
 * The rendered report, which is the only place two properties can be checked end to end.
 *
 * FIRST: that no character of a customer's document reaches it. `corpusSignals.test.ts`
 * asserts that of the counters; this asserts it of the string that is printed to a terminal
 * and written to a file, which is where it would actually matter.
 *
 * SECOND: that a run which measured nothing SAYS so. A report that quietly omitted tier C, or
 * printed an empty corpus section as though it were a measured zero, is the exact failure the
 * sibling project's third law is about -- and it would be invisible in every other test,
 * because every counter would still be correct.
 */

import { describe, expect, test as it } from "bun:test";

import type { GoldScore } from "./accuracy.ts";
import { type AccuracyRun, renderReport } from "./accuracyReport.ts";
import { measureCorpus } from "./corpusSignals.ts";
import { summariseRecall } from "./ooxmlOracle.ts";

const SCORED: GoldScore = {
  cases: [
    {
      id: "docx-nested-table",
      feature: "a table cell holding another table",
      measured: true,
      method: "docx",
      fidelity: { expected: 100, kept: 100, added: 10 },
    },
    {
      id: "pdf-ocr-ascii",
      feature: "a two-page render read by tesseract",
      measured: false,
      why: "extractor-missing:tesseract",
    },
  ],
  expected: 100,
  kept: 100,
  added: 10,
  measured: 1,
  unmeasured: 1,
};

function run(over: Partial<AccuracyRun> = {}): string {
  return renderReport({
    at: "2026-09-22T00:00:00.000Z",
    gold: SCORED,
    corpus: null,
    corpusCapped: false,
    recall: null,
    gaps: [],
    ...over,
  });
}

describe("a run that could not reach the corpus", () => {
  it("says the corpus was not measured rather than printing a zero", () => {
    const report = run();
    expect(report).toContain("TIER B -- the real corpus");
    expect(report).toContain("NOT MEASURED");
  });

  it("prints the corpus once it has one", () => {
    const report = run({
      corpus: measureCorpus([
        { method: "pdf_text", reason: null, truncated: false, sourceBytes: 2048, text: "a" },
      ]),
    });
    expect(report).toContain("1 extracted documents sampled");
    expect(report).not.toContain("TIER B -- the real corpus\n\n  NOT MEASURED");
  });
});

describe("a capped sample", () => {
  const corpus = measureCorpus([
    { method: "pdf_text", reason: null, truncated: false, sourceBytes: 2048, text: "a" },
  ]);

  it("says so, because every rate is then conditional on the cap", () => {
    expect(run({ corpus, corpusCapped: true })).toContain("CAP REACHED");
  });

  it("stays quiet when the sample was the whole corpus", () => {
    expect(run({ corpus, corpusCapped: false })).not.toContain("CAP REACHED");
  });
});

describe("what a report always ends with", () => {
  it("names a gold case this machine could not run, and does not score it", () => {
    const report = run();
    expect(report).toContain("UNMEASURED  extractor-missing:tesseract");
    expect(report).toContain("pdf-ocr-ascii");
    expect(report).toContain("1 unmeasured");
  });

  it("appends the standing gaps even when the caller passed none", () => {
    // The caller cannot omit tier C: `renderReport` adds it. A report whose conditions did
    // not travel with its numbers is one the next reader takes for unconditional.
    const report = run({ gaps: [] });
    expect(report).toContain("TIER C -- what this run did NOT measure");
    expect(report).toContain("OCR fidelity on a real scan");
    expect(report).toContain("GARBAGE-FREE IS NOT ACCURATE");
  });

  it("puts the caller's own gaps in as well", () => {
    expect(run({ gaps: [{ what: "the oracle", why: "no object store" }] })).toContain(
      "* the oracle",
    );
  });
});

describe("what the rendered report may carry", () => {
  it("prints no character of a customer's document", () => {
    const secret = "Nguyen Van A agrees to pay 4,500.00 SGD";
    const report = run({
      corpus: measureCorpus([
        { method: "image_ocr", reason: null, truncated: false, sourceBytes: 250_000, text: secret },
        { method: null, reason: secret, truncated: false, sourceBytes: 2048, text: secret },
      ]),
      recall: summariseRecall([{ kind: "word", declared: 10, found: 4, runs: 2, parts: 3 }]),
    });

    expect(report).not.toContain("Nguyen");
    expect(report).not.toContain("4,500.00");
    expect(report).not.toContain("agrees to pay");
    // ...and it did still count them, so the assertion above is about what is printed and not
    // about the rows having been dropped.
    expect(report).toContain("image_ocr");
    expect(report).toContain("unrecognised-reason-shape");
  });

  it("gives every rate its denominator", () => {
    // A bare percentage is the thing law 3 is about. `100.0% (100/100)` can be checked; a
    // lone `100.0%` cannot be told from one document scored out of thirteen.
    expect(run()).toContain("100.0% (100/100)");
  });
});
