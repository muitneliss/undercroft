/**
 * The alignment primitive and tier A, pinned from both sides.
 *
 * WHAT A SUITE CAN AND CANNOT DO FOR THIS MODULE. It cannot assert the score: the number is
 * the deliverable and a test that froze it would turn every reader improvement red. What it
 * can do is assert that the measurement TELLS THE TRUTH ABOUT ITSELF -- above all that a
 * machine with no `tesseract` reports unmeasured rather than zero, which is the difference
 * between a gap and a clean bill of health.
 *
 * Every guard gets the two tests `.claude/rules/tests.md` requires. A guard with only its
 * firing case is satisfied by a measurement that always complains.
 *
 * THE OFFLINE TIER HAS NO POPPLER AND NO TESSERACT, so the PDF and OCR gold cases report
 * unmeasured here -- which is itself one of the things asserted below. `task
 * db:extract-accuracy` on a machine that has them is what produces their scores.
 */

import { describe, expect, test as it } from "bun:test";

import { align, type GoldCase, scoreGold, UNMEASURED } from "./accuracy.ts";
import { extractDocument } from "./extractText.ts";
import { GOLD_SET } from "./goldSet.ts";
import { pdfOf } from "./testing.ts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * A spawn that answers the way a machine with nothing installed does.
 *
 * Not a mock: `Bun.spawn` RAISES rather than exiting non-zero when the executable is absent,
 * so this is the real behaviour of an uninstalled binary expressed through the seam
 * `program.ts` already injects. `runProgram` turns it into `missing: true`.
 */
function nothingInstalled(): never {
  throw new Error("spawn ENOENT");
}

/** A spawn that runs and fails. A different fact, and the readers say so differently. */
function everythingFails(): Promise<{ exitCode: number; output: string }> {
  return Promise.resolve({ exitCode: 1, output: "" });
}

/** Which cases need poppler or tesseract, and so cannot be scored in the offline tier. */
function needsABinary(one: GoldCase): boolean {
  return one.id.startsWith("pdf-");
}

describe("align", () => {
  it("keeps every character when the output holds the text unchanged", () => {
    expect(align("Hợp đồng dịch vụ", "Hợp đồng dịch vụ")).toEqual({
      expected: 16,
      kept: 16,
      added: 0,
    });
  });

  it("loses the characters an output dropped", () => {
    // "Total 315.00" with the amount gone: a clause that silently was not there.
    expect(align("Total 315.00", "Total")).toEqual({ expected: 12, kept: 5, added: 0 });
  });

  it("charges a separator to `added` and not to the score", () => {
    // What a correct `.docx` table read looks like: every authored character present, plus
    // the reader's own pipes. Scoring those would measure the convention, not the document.
    expect(align("Service Amount", "Service | Amount")).toEqual({
      expected: 14,
      kept: 14,
      added: 2,
    });
  });

  it("scores composed and decomposed Vietnamese as the same characters", () => {
    // NFC first, or `ế` written as e plus two combining marks scores a third of its
    // characters against a reader that is saying exactly the same word.
    const composed = "kế toán";
    expect(align(composed, composed.normalize("NFD"))).toEqual({
      expected: 7,
      kept: 7,
      added: 0,
    });
  });
});

describe("the gold set, against the shipped readers", () => {
  it("reads every document that needs no native binary at full fidelity", async () => {
    const score = await scoreGold(
      { spawn: nothingInstalled, workDir: "/tmp" },
      GOLD_SET.filter((one) => !needsABinary(one)),
    );

    expect(score.unmeasured).toBe(0);
    expect(score.kept).toBe(score.expected);
    expect(score.expected).toBeGreaterThan(500);
  });

  it("reports a document it has no binary for as UNMEASURED, never as zero", async () => {
    const score = await scoreGold(
      { spawn: nothingInstalled, workDir: "/tmp" },
      GOLD_SET.filter(needsABinary),
    );

    // The whole of the third state. A machine that cannot run the reader has not established
    // that the reader is wrong, and folding this into a zero would report a false defect on
    // every CI run -- or, far worse, a clean score once somebody "fixed" it the other way.
    expect(score.measured).toBe(0);
    expect(score.unmeasured).toBeGreaterThan(0);
    expect(score.expected).toBe(0);
    for (const one of score.cases) {
      expect(one.measured ? "measured" : one.why).toStartWith("extractor-missing:");
    }
  });

  it("scores a reader that RAN and refused at zero, which is a result", async () => {
    const score = await scoreGold({ spawn: everythingFails, workDir: "/tmp" }, [
      {
        id: "docx-not-a-zip",
        feature: "bytes that are not a document at all",
        // An HTML sign-in page a sync collected under the wrong content type: real, and the
        // reader answers `docx-unreadable` rather than an empty document.
        bytes: new TextEncoder().encode("<html>sign in to continue</html>"),
        expected: "Schedule of Fees 315.00",
        read: (deps, document) => extractDocument(deps, { ...document, contentType: DOCX }),
      },
    ]);

    expect(score.measured).toBe(1);
    expect(score.unmeasured).toBe(0);
    expect(score.kept).toBe(0);
    expect(score.expected).toBeGreaterThan(0);
  });

  it("gives every case a distinct id, since the scorer writes bytes under it", () => {
    // Two cases sharing an id would overwrite each other's file, and the second would be
    // scored against the first one's bytes -- a wrong number with nothing to show for it.
    expect(new Set(GOLD_SET.map((one) => one.id)).size).toBe(GOLD_SET.length);
  });
});

describe("the PDF the gold set is written with", () => {
  it("writes a file whose cross reference offsets point at their objects", () => {
    // The whole OCR tier rests on poppler accepting this. An offset computed in UTF-16 units
    // over a file written as UTF-8 points into the middle of an object, and poppler then
    // reports a damaged file rather than the text -- which would read as an OCR defect.
    const text = new TextDecoder().decode(pdfOf([["Hợp đồng"], ["Acme Holdings"]]));
    const startXref = Number.parseInt(/startxref\n(?<at>\d+)/u.exec(text)?.groups?.at ?? "-1", 10);
    expect(text.slice(startXref, startXref + 4)).toBe("xref");

    const offsets = [...text.matchAll(/^(?<at>\d{10}) 00000 n $/gmu)].map((row) =>
      Number.parseInt(row.groups?.at ?? "-1", 10),
    );
    expect(offsets).not.toBeEmpty();
    for (const [at, offset] of offsets.entries()) {
      expect(text.slice(offset)).toStartWith(`${at + 1} 0 obj`);
    }
  });

  it("escapes non-ASCII rather than writing it, so the file stays byte-addressable", () => {
    const bytes = pdfOf([["Hợp đồng dịch vụ"]]);
    expect(bytes.every((byte) => byte < 128)).toBe(true);
    // And the character is still named, so `pdftotext` answers with the one we meant.
    expect(new TextDecoder().decode(bytes)).toContain("/uni1EE3");
  });
});

describe("the standing gaps", () => {
  it("names what the measurement does not establish", () => {
    // Law 3: a number is conditional on what it was taken over. A change that quietly emptied
    // this list would ship a report whose figures look unconditional.
    expect(UNMEASURED).not.toBeEmpty();
    for (const gap of UNMEASURED) {
      expect(gap.what).not.toBeEmpty();
      expect(gap.why).not.toBeEmpty();
    }
  });

  it("leads with the OCR gap, which is the one a clean output hides", () => {
    expect(UNMEASURED[0]?.what).toContain("OCR");
  });
});
