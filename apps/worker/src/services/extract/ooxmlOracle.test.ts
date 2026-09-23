/**
 * The OOXML oracle, pinned from both sides.
 *
 * THE FALSE-NEGATIVE TESTS ARE THE POINT OF THIS SUITE. An oracle that reports a defect where
 * the reader is right is worse than no oracle: it sends a person to open a customer's document
 * and find nothing, which is exactly the review queue law 1 says to measure before opening.
 * Two such false negatives were found by running this against the gold set -- a Word run split
 * mid-word scored a correct reader at 11%, and a workbook's shared strings scored one at 82%
 * -- and the two tests below are those shapes, kept so the oracle cannot drift back.
 *
 * The firing case is `word/comments.xml`: a part `docx.ts` genuinely does not read, which is
 * the whole reason the oracle exists.
 */

import { describe, expect, test as it } from "bun:test";

import { ooxmlRecall, type OoxmlRecall, summariseRecall } from "./ooxmlOracle.ts";
import { pdfOf, zipOf } from "./testing.ts";

function wordDocument(parts: Readonly<Record<string, string>>): Uint8Array {
  return zipOf(Object.entries(parts).map(([name, body]) => ({ name, body })));
}

const ONE_PARAGRAPH =
  "<w:document><w:body><w:p><w:r><w:t>Acme Holdings</w:t></w:r></w:p></w:body></w:document>";

describe("what a document declares against what a reader produced", () => {
  it("scores a fully read document at recall 1", () => {
    expect(
      ooxmlRecall(wordDocument({ "word/document.xml": ONE_PARAGRAPH }), "Acme Holdings"),
    ).toEqual({ kind: "word", declared: 13, found: 13, runs: 1, parts: 1 });
  });

  it("scores below 1 when a reader drops a part the document declares", () => {
    // `word/comments.xml` is a real part `docx.ts` does not enumerate, so this is the shape
    // the oracle exists for: text the document carries and the output does not, found with no
    // ground truth and no human.
    const recall = ooxmlRecall(
      wordDocument({
        "word/document.xml": ONE_PARAGRAPH,
        "word/comments.xml":
          "<w:comments><w:p><w:r><w:t>Check the filing fee</w:t></w:r></w:p></w:comments>",
      }),
      "Acme Holdings",
    );
    expect(recall?.parts).toBe(2);
    expect(recall?.found).toBeLessThan(recall?.declared ?? 0);
  });

  it("does not invent a miss when Word splits a run in the middle of a word", () => {
    // Measured, not hypothetical: concatenating the runs and aligning in order scored this
    // exact shape at 11% against a correct reader.
    const recall = ooxmlRecall(
      wordDocument({
        "word/document.xml":
          "<w:document><w:body><w:p><w:r><w:t>Acme Hold</w:t><w:t>ings Pte Ltd</w:t></w:r></w:p></w:body></w:document>",
      }),
      "Acme Holdings Pte Ltd",
    );
    expect(recall?.found).toBe(recall?.declared ?? -1);
  });

  it("does not invent a miss when a workbook shows its strings in cell order", () => {
    // The other measured false negative: the table declares in TABLE order and the output
    // shows in CELL order, which scored a correct read at 82%.
    const recall = ooxmlRecall(
      zipOf([
        {
          name: "xl/sharedStrings.xml",
          body: "<sst><si><t>Notes</t></si><si><t>Client</t></si></sst>",
        },
        {
          name: "xl/worksheets/sheet1.xml",
          body: '<worksheet><sheetData><row r="1"><c t="s"><v>1</v></c><c t="s"><v>0</v></c></row></sheetData></worksheet>',
        },
      ]),
      "Client\tNotes",
    );
    expect(recall?.kind).toBe("workbook");
    expect(recall?.found).toBe(recall?.declared ?? -1);
  });

  it("does not count a whitespace-only run as a free match", () => {
    // `<w:t xml:space="preserve"> </w:t>` is a space a reader may collapse. Counting it would
    // put a match nobody earned into every document's numerator.
    const recall = ooxmlRecall(
      wordDocument({
        "word/document.xml":
          '<w:document><w:body><w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p></w:body></w:document>',
      }),
      "",
    );
    expect(recall).toEqual({ kind: "word", declared: 0, found: 0, runs: 0, parts: 1 });
  });

  it("excludes a phonetic guide, which duplicates the reading it annotates", () => {
    // The reader drops `<rPh>` and is right to; an oracle that declared it would report a
    // defect against correct output. This module decides that independently of `xlsx.ts`.
    const recall = ooxmlRecall(
      zipOf([
        {
          name: "xl/sharedStrings.xml",
          body: '<sst><si><t>Tokyo branch</t><rPh sb="0" eb="5"><t>とうきょう</t></rPh></si></sst>',
        },
        { name: "xl/worksheets/sheet1.xml", body: "<worksheet><sheetData/></worksheet>" },
      ]),
      "Tokyo branch",
    );
    expect(recall?.runs).toBe(1);
    expect(recall?.found).toBe(recall?.declared ?? -1);
  });

  it("has no opinion about bytes that are not an OOXML document", () => {
    // Not a score of zero: `null` is the oracle declining, and a PDF is not a failed docx.
    expect(ooxmlRecall(pdfOf([["Acme Holdings"]]), "Acme Holdings")).toBeNull();
  });
});

describe("summariseRecall", () => {
  function word(found: number, declared: number): OoxmlRecall {
    return { kind: "word", declared, found, runs: 1, parts: 1 };
  }

  it("keeps the two container kinds apart rather than averaging them", () => {
    const summary = summariseRecall([
      word(10, 10),
      { kind: "workbook", declared: 10, found: 5, runs: 1, parts: 1 },
    ]);
    expect(summary.byKind.map((audit) => [audit.kind, audit.found, audit.declared])).toEqual([
      ["word", 10, 10],
      ["workbook", 5, 10],
    ]);
  });

  it("counts a document the oracle declined as unscored, not as a perfect one", () => {
    const summary = summariseRecall([word(10, 10), null, null]);
    expect(summary.unscored).toBe(2);
    expect(summary.byKind[0]?.documents).toBe(1);
  });

  it("counts a document that scored short", () => {
    expect(summariseRecall([word(10, 10), word(4, 10)]).byKind[0]?.short).toBe(1);
  });

  it("counts no document short when every one was read whole", () => {
    expect(summariseRecall([word(10, 10), word(7, 7)]).byKind[0]?.short).toBe(0);
  });
});
