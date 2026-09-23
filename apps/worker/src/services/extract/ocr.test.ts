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

import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import type { Spawn } from "../transform.ts";
import { type Extracted, extractDocument } from "./extractText.ts";
import {
  IMAGE_TOO_SMALL,
  OCR_FOUND_NOTHING,
  OCR_MIN_IMAGE_BYTES,
  OCR_OUT_OF_TIME,
  PDFTOPPM_FAILED,
  TESSERACT_FAILED,
} from "./ocr.ts";
import { OCR_PAGE_CAP } from "./pdfPages.ts";
import { DEFAULT_EXTRACT_TIMEOUT_MS } from "./program.ts";

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

/**
 * One program installed and everything after it absent, which is what a half-provisioned image
 * looks like: `pdftotext` answers, and the `pdftoppm` beside it in the same package does not.
 */
function spawnMissingAfter(installed: string): Spawn {
  return (cmd) =>
    cmd[0] === installed
      ? Promise.resolve({ exitCode: 0, output: SCAN_LAYER })
      : Promise.reject(new Error("ENOENT: no such file"));
}

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

/**
 * The scanned-PDF reader, against a scratch directory and two programs that behave the way
 * poppler and tesseract do.
 *
 * `pdftoppm` IS FAKED BY WRITING REAL FILES, and that is the point rather than an accident.
 * The reader must LIST the directory, because poppler pads the page number to the width of the
 * document's page count -- 9 pages gives `-1.png`, 12 gives `-01.png`, 120 gives `-001.png`
 * (measured). A fake that handed back a list of names would let a reader that constructed
 * `-1.png` pass, and that reader finds every page of a short scan and nothing at all of a long
 * one. So the fake writes the same names poppler writes and the reader has to find them.
 *
 * The clock is injected for the same reason the spawn is: a deadline that divides across
 * thirty children is testable in a millisecond, or not at all.
 */
interface ScanOptions {
  /** How many pages the PDF really has -- which is what sets the zero-padding width. */
  readonly pages: number;
  /** What tesseract says a page holds. Whitespace is how a blank page answers. */
  readonly textFor?: (page: number) => string;
  /** A page whose tesseract exits non-zero, as one unreadable page in a stack would. */
  readonly failPage?: number;
  /** Poppler: writes the pages, exits non-zero, or exits zero having written nothing. */
  readonly rasteriser?: "fails" | "silent";
  /** How far the clock moves per child, so a deadline can be crossed without waiting. */
  readonly tickMs?: number;
}

/** What a scan's text layer leaves behind, which is what sends `readPdf` down the OCR path. */
const SCAN_LAYER = "  \f  page 1  \f ";
const SCAN_BYTES = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "undercroft-ocr-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** The page number poppler encoded in an image's name, whatever it padded it to. */
function pageNumberOf(path: string): number {
  const name = basename(path);
  return Number.parseInt(name.slice(name.lastIndexOf("-") + 1, -".png".length), 10);
}

/** Write the images poppler would have written for this command. */
async function writePages(cmd: readonly string[], pages: number): Promise<void> {
  const prefix = cmd.at(-1) ?? "";
  const limit = Number.parseInt(cmd[cmd.indexOf("-l") + 1] ?? "0", 10);
  // The width follows the DOCUMENT's page count, not the range asked for. This one line is
  // what the reader's directory listing exists for.
  const width = String(pages).length;
  for (let page = 1; page <= Math.min(pages, limit); page += 1) {
    await writeFile(`${prefix}-${String(page).padStart(width, "0")}.png`, "PNG");
  }
}

function scanner(options: ScanOptions): {
  spawn: Spawn;
  calls: string[][];
  deadlines: number[];
  now: () => number;
} {
  const calls: string[][] = [];
  const deadlines: number[] = [];
  let elapsed = 0;

  const spawn: Spawn = async (cmd, spawnOptions) => {
    calls.push([...cmd]);
    deadlines.push(spawnOptions.timeoutMs);
    elapsed += options.tickMs ?? 0;

    if (cmd[0] === "pdftotext") {
      return { exitCode: 0, output: SCAN_LAYER };
    }
    if (cmd[0] === "pdftoppm") {
      if (options.rasteriser === "fails") {
        return { exitCode: 1, output: "" };
      }
      if (options.rasteriser !== "silent") {
        await writePages(cmd, options.pages);
      }
      return { exitCode: 0, output: "" };
    }

    const page = pageNumberOf(cmd[1] ?? "");
    if (page === options.failPage) {
      return { exitCode: 1, output: "" };
    }
    const text = options.textFor ?? ((at: number): string => `Trang ${at}: Acme Holdings`);
    return { exitCode: 0, output: text(page) };
  };

  return { spawn, calls, deadlines, now: (): number => elapsed };
}

/** A scanned PDF on disk in the scratch directory, read the way `runExtract` reads one. */
async function extractScan(parts: { spawn: Spawn; now?: () => number }): Promise<Extracted> {
  const path = join(scratch, "doc-17a3");
  await writeFile(path, SCAN_BYTES);
  return await extractDocument(
    {
      spawn: parts.spawn,
      workDir: scratch,
      ...(parts.now === undefined ? {} : { now: parts.now }),
    },
    { contentType: "application/pdf", bytes: SCAN_BYTES, path },
  );
}

/** The page images still lying about in the scratch directory. */
async function leftoverPages(): Promise<string[]> {
  return (await readdir(scratch)).filter((name) => name.endsWith(".png"));
}

describe("a scanned PDF", () => {
  it("is read whole, however poppler numbered its pages", async () => {
    // Twelve pages, so poppler pads to two digits and a reader that built `-1.png` finds
    // NOTHING -- which would arrive downstream as a document that says nothing rather than as
    // a bug. This is the test that makes the directory listing load-bearing.
    const { spawn } = scanner({ pages: 12 });

    const result = await extractScan({ spawn });

    expect(result.method).toBe("pdf_ocr");
    expect(result.text).toContain("Trang 1:");
    expect(result.text).toContain("Trang 12:");
    expect(result.truncated).toBe(false);
  });

  it("is rasterised before it is read, because tesseract cannot open a PDF", async () => {
    const { spawn, calls } = scanner({ pages: 2 });

    await extractScan({ spawn });

    expect(calls.map((cmd) => cmd[0])).toEqual(["pdftotext", "pdftoppm", "tesseract", "tesseract"]);
    // The pages go to disk and tesseract opens them by name: nothing binary crosses the seam.
    expect(calls[2]?.[1]).toContain(scratch);
  });

  it("leaves none of its page images behind", async () => {
    // A 30-page scan is tens of megabytes of transient PNGs, beside a document already on disk.
    const { spawn } = scanner({ pages: 4 });

    await extractScan({ spawn });

    expect(await leftoverPages()).toEqual([]);
  });

  it("leaves none behind when a page fails either", async () => {
    // The firing side of the same guard: cleanup that only runs on success is cleanup that
    // runs when it is least needed.
    const { spawn } = scanner({ pages: 4, failPage: 2 });

    await extractScan({ spawn });

    expect(await leftoverPages()).toEqual([]);
  });
});

describe("a scan longer than the page cap", () => {
  it("is read to the cap and SAYS it was cut", async () => {
    // Silent truncation is the one failure worse than refusing outright: a contract cut at
    // page 30 reads exactly like a complete one, and nothing downstream can tell.
    const { spawn, calls } = scanner({ pages: OCR_PAGE_CAP + 1 });

    const result = await extractScan({ spawn });

    expect(result.method).toBe("pdf_ocr");
    expect(result.truncated).toBe(true);
    expect(result.text).toContain(`Trang ${OCR_PAGE_CAP}:`);
    expect(result.text).not.toContain(`Trang ${OCR_PAGE_CAP + 1}:`);
    // The page past the cap is rendered as evidence that there WAS one, and never read.
    expect(calls.filter((cmd) => cmd[0] === "tesseract")).toHaveLength(OCR_PAGE_CAP);
  });

  it("is not what a document exactly at the cap gets", async () => {
    // The quiet side. A flag set on every long document says nothing about any of them.
    const { spawn, calls } = scanner({ pages: OCR_PAGE_CAP });

    const result = await extractScan({ spawn });

    expect(result.truncated).toBe(false);
    expect(calls.filter((cmd) => cmd[0] === "tesseract")).toHaveLength(OCR_PAGE_CAP);
  });
});

describe("one page of a stack that cannot be read", () => {
  it("fails the whole document rather than leaving a hole in it", async () => {
    // A cut tail can be reported; a missing middle cannot. Storing pages 1-2 and 4-5 would put
    // a contract with clause three deleted into the index, reading as one that never had it.
    const { spawn } = scanner({ pages: 5, failPage: 3 });

    const result = await extractScan({ spawn });

    expect(result.reason).toBe(TESSERACT_FAILED);
    expect(result.method).toBeNull();
    expect(result.text).toBe("");
  });

  it("is not what a BLANK page does, which is skipped", async () => {
    // Scans are full of blank pages -- separator sheets, the backs of pages. Failing a
    // document for one would refuse most of the corpus.
    const { spawn } = scanner({
      pages: 5,
      textFor: (page) => (page === 3 ? "\n\f \n" : `Trang ${page}: Acme Holdings`),
    });

    const result = await extractScan({ spawn });

    expect(result.method).toBe("pdf_ocr");
    expect(result.text).toContain("Trang 2:");
    expect(result.text).toContain("Trang 4:");
    expect(result.truncated).toBe(false);
  });
});

describe("a scan that went all the way through and found nothing", () => {
  it("ends with a NAMED reason, never with empty text passed off as a read", async () => {
    // This is what `needs-ocr` used to guarantee and must still hold now that the refusal has
    // been replaced by a chain: a scan travels pdftotext -> pdftoppm -> tesseract, and at the
    // end of all three it either says what it found or says why it found nothing. The failure
    // this forbids is the quiet one -- `method: "pdf_ocr"` over an empty string, which reads
    // downstream as a contract that genuinely says nothing (`CLAUDE.md` rule 2).
    const { spawn } = scanner({ pages: 3, textFor: () => "\n\f \n" });

    const result = await extractScan({ spawn });

    expect(result.reason).toBe(OCR_FOUND_NOTHING);
    expect(result.method).toBeNull();
    expect(result.text).toBe("");
  });

  it("is told apart from a scan that found one line", async () => {
    // The quiet side: a document with a single readable page is READ, not refused, and the
    // text is what that page said.
    const { spawn } = scanner({
      pages: 3,
      textFor: (page) => (page === 2 ? "Đã thanh toán" : "\n\f \n"),
    });

    const result = await extractScan({ spawn });

    expect(result.method).toBe("pdf_ocr");
    expect(result.reason).toBeNull();
    expect(result.text).toBe("Đã thanh toán");
  });
});

describe("poppler, when it cannot hand over a page", () => {
  it("names itself when it is not installed", async () => {
    const result = await extractScan({ spawn: spawnMissingAfter("pdftotext") });

    expect(result.reason).toBe("extractor-missing:pdftoppm");
  });

  it("says something else when it ran and failed", async () => {
    const { spawn } = scanner({ pages: 3, rasteriser: "fails" });

    expect((await extractScan({ spawn })).reason).toBe(PDFTOPPM_FAILED);
  });

  it("says the same when it exits zero having written nothing", async () => {
    // A PDF poppler opened and got no page out of. "We have no page to read" is one fact
    // however it arose, and a second name for it would be a distinction nobody can act on.
    const { spawn } = scanner({ pages: 3, rasteriser: "silent" });

    expect((await extractScan({ spawn })).reason).toBe(PDFTOPPM_FAILED);
  });
});

describe("the deadline a scan is held to", () => {
  it("is divided across its children, not handed to each of them", async () => {
    // `runProgram` applies `timeoutMs` per child, so thirty pages given the shared five
    // minutes each would let ONE document run for two and a half hours -- a reader quietly
    // exempting itself from the limit every other reader obeys.
    const { spawn, deadlines, now } = scanner({ pages: 4, tickMs: 10_000 });

    await extractScan({ spawn, now });

    const perPage = deadlines.slice(2);
    expect(perPage).toHaveLength(4);
    for (const [at, deadline] of perPage.entries()) {
      expect(deadline).toBeLessThan(DEFAULT_EXTRACT_TIMEOUT_MS);
      expect(deadline).toBeLessThan(perPage[at - 1] ?? Number.POSITIVE_INFINITY);
    }
  });

  it("still gives a single image the whole of it", async () => {
    // The quiet side: dividing is for the reader with many children. An image has one, and
    // shortening its deadline would be a cost paid by the 1,557 files that are not scans.
    const { spawn, deadlines } = scanner({ pages: 1 });

    await extract(spawn, { contentType: "image/png" });

    expect(deadlines).toEqual([DEFAULT_EXTRACT_TIMEOUT_MS]);
  });

  it("keeps what it read when time runs out part way, and says it is short", async () => {
    const { spawn, now } = scanner({ pages: 10, tickMs: 60_000 });

    const result = await extractScan({ spawn, now });

    expect(result.method).toBe("pdf_ocr");
    expect(result.text).toContain("Trang 1:");
    expect(result.text).not.toContain("Trang 10:");
    expect(result.truncated).toBe(true);
  });

  it("refuses by name when it runs out before a single page is read", async () => {
    // Nothing was established about these bytes, so this is a verdict about a budget and not
    // about a document -- which is why it is not `tesseract-failed` and must stay re-readable.
    const { spawn, now } = scanner({ pages: 10, tickMs: DEFAULT_EXTRACT_TIMEOUT_MS + 1000 });

    const result = await extractScan({ spawn, now });

    expect(result.reason).toBe(OCR_OUT_OF_TIME);
    expect(result.reason).not.toBe(TESSERACT_FAILED);
    expect(result.method).toBeNull();
  });
});
