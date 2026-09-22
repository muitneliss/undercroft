/**
 * What the OCR reader promises: only documents are OCR'd, Vietnamese is always asked for, and
 * the four ways of not reading an image stay four different facts.
 *
 * No mocks, and no tesseract on the machine. The `Spawn` seam is a plain arrow function that
 * answers the way the binary would, in the shape `extractText.test.ts` already established for
 * poppler -- which is what lets the offline gate run this suite at all. "Was it reached" is a
 * captured list of the commands that were run, never an assertion about a spy.
 *
 * THE COMMAND ITSELF IS ASSERTED, spelled out here rather than read off the module's own
 * constant. A test that imported the language string would follow an edit that dropped `vie`
 * and stay green, and English-only OCR of a Vietnamese invoice is the failure this whole
 * reader exists to avoid: it does not error, it returns confident words nobody wrote.
 */

import { describe, expect, test as it } from "bun:test";

import type { Spawn } from "../transform.ts";
import { type Extracted, extractDocument } from "./extractText.ts";
import {
  IMAGE_TOO_SMALL,
  OCR_FOUND_NOTHING,
  OCR_MIN_IMAGE_BYTES,
  TESSERACT_FAILED,
} from "./ocr.ts";

/** A page of real text, invented per `pii.md`, with the diacritics 17% of the corpus carries. */
const A_PAGE =
  "HOÁ ĐƠN GIÁ TRỊ GIA TĂNG\nAcme Holdings Pte Ltd\n" +
  "Tiền thanh toán: 1.234,10 SGD\nĐiều khoản thanh toán: 30 ngày";

/** The eight bytes every PNG starts with, so the fixture is the kind of thing it claims to be. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** An image of `bytes` length: a real signature, then whatever fills it out to the size. */
function imageOf(bytes: number): Uint8Array {
  const image = new Uint8Array(bytes);
  image.set(PNG_SIGNATURE.slice(0, bytes));
  return image;
}

function spawnAnswering(output: string, exitCode = 0): { spawn: Spawn; calls: string[][] } {
  const calls: string[][] = [];
  const spawn: Spawn = (cmd) => {
    calls.push([...cmd]);
    return Promise.resolve({ exitCode, output });
  };
  return { spawn, calls };
}

/** A program that is not installed: `Bun.spawn` raises rather than exiting non-zero. */
const spawnMissing: Spawn = () => Promise.reject(new Error("ENOENT: no such file"));

/** A spawn that must never fire. Reaching it fails the test that said nothing would. */
const spawnNothing: Spawn = () => Promise.reject(new Error("spawned a child that was not wanted"));

function extract(
  spawn: Spawn,
  over: Partial<{ contentType: string; bytes: Uint8Array }> = {},
): Promise<Extracted> {
  return extractDocument(
    { spawn, workDir: "/tmp/ocr-test" },
    {
      contentType: over.contentType ?? "image/png",
      // Comfortably past the gate, so a case that is not about the gate does not sit on it.
      bytes: over.bytes ?? imageOf(OCR_MIN_IMAGE_BYTES * 2),
      path: "/tmp/ocr-test/doc-17a3",
    },
  );
}

describe("an image big enough to be a document", () => {
  it("is read by OCR, and the text it read is what is stored", async () => {
    const { spawn, calls } = spawnAnswering(A_PAGE);

    const result = await extract(spawn);

    expect(result.method).toBe("image_ocr");
    expect(result.reason).toBeNull();
    expect(result.text).toContain("Tiền thanh toán");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("tesseract");
  });

  it("is always asked for in Vietnamese as well as English", async () => {
    // The guard with no visible symptom. English-only OCR of a Vietnamese invoice returns
    // plausible English words that were never on the page -- data that is confidently false,
    // which nothing downstream can tell from data that is true. 69 of the 409 documents read
    // on production carry these diacritics.
    const { spawn, calls } = spawnAnswering(A_PAGE);

    await extract(spawn);

    const cmd = calls[0] ?? [];
    const languages = cmd[cmd.indexOf("-l") + 1] ?? "";
    expect(cmd).toContain("-l");
    expect(languages).toContain("vie");
    expect(languages).toContain("eng");
  });

  it("takes the file by the path it was written under, which has no extension", async () => {
    // `runExtract` writes `doc-<sanitised id>` and nothing may start keying off a suffix;
    // tesseract sniffs the content through leptonica and does not care.
    const { spawn, calls } = spawnAnswering(A_PAGE);

    await extract(spawn);

    expect(calls[0]).toContain("/tmp/ocr-test/doc-17a3");
  });

  it("is read whichever of the image types the provider declared", async () => {
    // Two IANA types and the spelling that is not one: mail clients write `image/jpg`, the
    // catalogue records what was declared, and the bytes are a JPEG in all three cases.
    for (const contentType of ["image/png", "image/jpeg", "image/jpg"]) {
      const { spawn } = spawnAnswering(A_PAGE);

      expect((await extract(spawn, { contentType })).method).toBe("image_ocr");
    }
  });
});

describe("an image too small to be a document", () => {
  it("is refused by name, and nothing is spawned for it", async () => {
    // 815 of the 1,557 images in the lake are under this line: logos, signature blocks, the
    // icons in a mail footer. OCR-ing them costs a child process each to produce fragments
    // that make full-text search worse -- so the decision is taken before the process, and
    // `spawnNothing` is what proves it was.
    const result = await extract(spawnNothing, { bytes: imageOf(OCR_MIN_IMAGE_BYTES - 1) });

    expect(result.reason).toBe(IMAGE_TOO_SMALL);
    expect(result.method).toBeNull();
    expect(result.text).toBe("");
  });

  it("is the only side of the line that refuses: the byte above it is read", async () => {
    // The quiet side. A gate that refused everything would pass the test above and read
    // nothing at all, which is the shape "a guard needs two tests" exists for.
    const { spawn, calls } = spawnAnswering(A_PAGE);

    const result = await extract(spawn, { bytes: imageOf(OCR_MIN_IMAGE_BYTES) });

    expect(result.method).toBe("image_ocr");
    expect(calls).toHaveLength(1);
  });
});

describe("the two ways tesseract does not answer", () => {
  it("names the program when it is not installed", async () => {
    // The same shape `pdftotext` already uses: one absent package is a refusal an operator can
    // act on, not a failed run.
    const result = await extract(spawnMissing);

    expect(result.reason).toBe("extractor-missing:tesseract");
    expect(result.method).toBeNull();
  });

  it("says something else entirely when it ran and failed", async () => {
    // Two different afternoons: install a package, or work out what is wrong with this file.
    // A single reason for both would make the ledger unable to tell them apart.
    const { spawn } = spawnAnswering("", 1);

    const result = await extract(spawn);

    expect(result.reason).toBe(TESSERACT_FAILED);
    expect(result.reason).not.toBe("extractor-missing:tesseract");
  });
});

describe("OCR that ran and found nothing", () => {
  it("is its own fact, not a failure and not an empty read", async () => {
    // The dividing line is READ versus FOUND NOTHING. An engine finding nothing today is a
    // verdict about the engine -- a language pack away from finding something -- so it is kept
    // distinct from "the engine broke", which is what makes it re-readable later. Storing the
    // empty string with a method instead would say the document is blank, which is the silent
    // zero this codebase refuses everywhere (`CLAUDE.md` rule 2).
    const { spawn } = spawnAnswering("\n\f  \n \f\n");

    const result = await extract(spawn);

    expect(result.reason).toBe(OCR_FOUND_NOTHING);
    expect(result.reason).not.toBe(TESSERACT_FAILED);
    expect(result.method).toBeNull();
  });

  it("is not what a page with a single line on it gets", async () => {
    // The quiet side, and the reason there is no second threshold here: the size gate has
    // already removed the furniture, so a short page is a short document and is stored as one.
    const { spawn } = spawnAnswering("Đã thanh toán");

    const result = await extract(spawn);

    expect(result.method).toBe("image_ocr");
    expect(result.text).toBe("Đã thanh toán");
  });
});

describe("a PDF, which tesseract cannot open at all", () => {
  it("is refused as needing OCR rather than handed to an engine that would fail", async () => {
    // Measured, not assumed: `tesseract scan.pdf stdout` answers "Pdf reading is not supported"
    // and exits 1. Falling through to it would record `tesseract-failed` on every scan -- which
    // reads as "this PDF is broken" when the truth is that nobody rasterised it. A `pdf_ocr`
    // reader needs a page image from `pdftoppm` first, and that is its own change.
    const { spawn, calls } = spawnAnswering("  \f  page 1  \f ");

    const result = await extract(spawn, {
      contentType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
    });

    expect(result.reason).toBe("needs-ocr");
    expect(calls.map((cmd) => cmd[0])).toEqual(["pdftotext"]);
  });

  it("with a real text layer never reaches OCR either", async () => {
    // The side that decides the bill: a working text layer must not be re-read by an engine
    // that costs seconds a page.
    const { spawn, calls } = spawnAnswering(A_PAGE);

    const result = await extract(spawn, {
      contentType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
    });

    expect(result.method).toBe("pdf_text");
    expect(calls.map((cmd) => cmd[0])).toEqual(["pdftotext"]);
  });
});
