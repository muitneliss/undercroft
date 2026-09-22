/**
 * What a refusal reason promises a reader: a sentence in their language, the raw code beside
 * it, and an honest answer to "is this something I have to do anything about".
 *
 * The severity is the load-bearing part. 230 signature images under the OCR size gate and one
 * missing `pdftotext` were rendered identically before ADR 0039, which is how a healthy run
 * came to look like a fault.
 */

import { describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import { anyActionable, presentReason, severityOf } from "./refusalReasons.ts";

const en = translatorFor("en");
const vi = translatorFor("vi");

describe("a refusal reason as a reader meets it", () => {
  it("tells a fact about the document from a fault in the deployment", () => {
    // The whole point of the band. These two are both "refused" and must never read alike.
    expect(severityOf("image-too-small-to-read")).toBe("benign");
    expect(severityOf("extractor-missing:pdftotext")).toBe("act");
  });

  it("is worded in the reader's language, and keeps its code in both", () => {
    const asked = presentReason(vi, "image-too-small-to-read");
    const read = presentReason(en, "image-too-small-to-read");

    expect(asked.title).toBe("Ảnh quá nhỏ để là một tài liệu");
    expect(read.title).toBe("Image too small to be a document");
    // The code is what an operator quotes to a developer, so it does not get translated.
    expect(asked.code).toBe(read.code);
  });

  it("names the missing program rather than saying a binary is missing", () => {
    // "extractor-missing" alone sends somebody to the source to find out which one.
    expect(presentReason(en, "extractor-missing:tesseract").title).toContain("tesseract");
    expect(presentReason(vi, "extractor-missing:tesseract").note).toContain("tesseract");
  });

  it("draws a code it has no words for as a gap, and errs toward needing a person", () => {
    // The ingest verbs refuse with their own vocabulary, so this case is reachable. Silence
    // would look like nothing happened; claiming it is benign would be a guess about a
    // reason we cannot name.
    const unknown = presentReason(en, "some-reason-nobody-worded");

    expect(unknown.known).toBe(false);
    expect(unknown.code).toBe("some-reason-nobody-worded");
    expect(unknown.severity).toBe("act");
  });

  it("marks a known reason as known, so the gap above means something", () => {
    expect(presentReason(en, "ocr-found-nothing").known).toBe(true);
  });

  it("never renders a key back at the reader", () => {
    // A raw key passes every "is it non-empty" check and is the failure this catches.
    for (const t of [vi, en]) {
      for (const code of ["legacy-doc-unsupported", "lake-object-unreadable", "ocr-out-of-time"]) {
        const reason = presentReason(t, code);
        expect(reason.title).not.toContain("journal.reason");
        expect(reason.note).not.toContain("journal.reason");
      }
    }
  });
});

describe("whether a rollup needs a person", () => {
  it("says so when any reason in it does", () => {
    expect(
      anyActionable([{ reason: "image-too-small-to-read" }, { reason: "tesseract-failed" }]),
    ).toBe(true);
  });

  it("stays quiet when none of them does", () => {
    // The other half of the guard: a rule that always answered `true` would pass the test
    // above and turn every healthy run back into something that looks like a fault.
    expect(
      anyActionable([{ reason: "image-too-small-to-read" }, { reason: "ocr-found-nothing" }]),
    ).toBe(false);
  });
});
