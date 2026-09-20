/**
 * What the extractor promises: every document leaves with a method or a reason, and the
 * expensive path is not taken when the cheap one already answered.
 *
 * No mocks. The spawn is a real function that answers the way poppler would, in the shape
 * `transform.test.ts` already established for dbt -- which is what lets the offline gate run
 * this suite with no poppler installed.
 */

import { describe, expect, test as it } from "bun:test";

import type { Spawn } from "../transform.ts";
import {
  DEFAULT_EXTRACT_TIMEOUT_MS,
  EMPTY_SOURCE,
  extractDocument,
  type Extracted,
  extractorMissing,
  LEGACY_DOC,
  MAX_TEXT_CHARS,
  normalizeText,
  TEXT_LAYER_MIN_CHARS,
  UNSUPPORTED_TYPE,
} from "./extractText.ts";

const BYTES = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n%%EOF\n");

/** A page of real text: comfortably past the threshold, invented per `pii.md`. */
const A_PAGE =
  "Acme Holdings agrees to supply the services described in schedule one, " +
  "invoiced monthly in arrears, for a term of twelve months from the commencement date.";

/** What a scan's text layer leaves behind: a stamp's worth of stray characters. */
const SCAN_NOISE = "  \f  page 1  \f ";

function spawnAnswering(output: string, exitCode = 0): { spawn: Spawn; calls: string[][] } {
  const calls: string[][] = [];
  const spawn: Spawn = (cmd) => {
    calls.push([...cmd]);
    return Promise.resolve({ exitCode, output });
  };
  return { spawn, calls };
}

/** A spawn for a program that is not installed: `Bun.spawn` raises rather than exiting. */
const spawnMissing: Spawn = () => Promise.reject(new Error("ENOENT: no such file"));

function extract(
  spawn: Spawn,
  over: Partial<{ contentType: string; bytes: Uint8Array }> = {},
): Promise<Extracted> {
  return extractDocument(
    { spawn, workDir: "/tmp/extract-test" },
    {
      contentType: over.contentType ?? "application/pdf",
      bytes: over.bytes ?? BYTES,
      path: "/tmp/extract-test/doc",
    },
  );
}

describe("a PDF's text layer", () => {
  it("is believed when it carries real text, and OCR is never reached", async () => {
    // The quiet side of the threshold, and the one that decides the bill: 58 PDFs re-read by
    // OCR because a working text layer was not trusted is tens of minutes of CPU per run.
    const { spawn, calls } = spawnAnswering(A_PAGE);

    const result = await extract(spawn);

    expect(result.method).toBe("pdf_text");
    expect(result.reason).toBeNull();
    expect(result.text).toContain("Acme Holdings");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("pdftotext");
  });

  it("is refused by name when it is only a scan's stray characters", async () => {
    // The firing side. A scanned contract still returns a few characters from a stamp, so
    // "the layer returned something" is not "the layer worked" -- and storing that handful
    // would read downstream as a contract that says almost nothing.
    const { spawn } = spawnAnswering(SCAN_NOISE);

    const result = await extract(spawn);

    expect(result.method).toBeNull();
    expect(result.reason).toBe("needs-ocr");
    expect(result.text).toBe("");
  });

  it("measures the threshold in characters a reader would see, not raw bytes", async () => {
    // Pins the normalisation the threshold depends on. Whitespace-padded noise must not pass
    // by being long; this is the guard that makes the two tests above mean what they say.
    expect(normalizeText(SCAN_NOISE).length).toBeLessThan(TEXT_LAYER_MIN_CHARS);
    expect(normalizeText(A_PAGE).length).toBeGreaterThanOrEqual(TEXT_LAYER_MIN_CHARS);
    expect(normalizeText("  a \n\n b \f c  ")).toBe("a b c");
  });
});

describe("a binary that is not installed", () => {
  it("is a refusal naming the program, not a crash", async () => {
    // The whole reason the offline gate can run this suite. Failing the run instead would
    // turn one absent package into "your documents did not extract", which is both less true
    // and less actionable than the name of the thing to install.
    const result = await extract(spawnMissing);

    expect(result.reason).toBe(extractorMissing("pdftotext"));
    expect(result.method).toBeNull();
  });

  it("is told apart from a program that ran and failed", async () => {
    // Two different afternoons: install poppler, or work out why this PDF is unreadable.
    const { spawn } = spawnAnswering("", 1);

    expect((await extract(spawn)).reason).toBe("pdftotext-failed");
  });
});

describe("the types that are not PDFs", () => {
  it("reads a text file in process, spawning nothing", async () => {
    const { spawn, calls } = spawnAnswering("");
    const bytes = new TextEncoder().encode("điều khoản thanh toán");

    const result = await extract(spawn, { contentType: "text/plain", bytes });

    expect(result.method).toBe("txt");
    // Vietnamese survives the decode: the operators' own language is the common case here.
    expect(result.text).toBe("điều khoản thanh toán");
    expect(calls).toHaveLength(0);
  });

  it("refuses the pre-2007 Word format by name rather than silently", async () => {
    const { spawn } = spawnAnswering("");

    expect((await extract(spawn, { contentType: "application/msword" })).reason).toBe(LEGACY_DOC);
  });

  it("refuses a type it has no reader for, and says that is what happened", async () => {
    const { spawn } = spawnAnswering("");

    expect((await extract(spawn, { contentType: "video/mp4" })).reason).toBe(UNSUPPORTED_TYPE);
  });

  it("ignores the charset a content type carries", async () => {
    // The catalogue stores what the provider declared, and a provider may declare either.
    const { spawn } = spawnAnswering("");
    const bytes = new TextEncoder().encode("hello");

    const result = await extract(spawn, { contentType: "text/plain; charset=utf-8", bytes });

    expect(result.method).toBe("txt");
  });
});

describe("a document with nothing in it", () => {
  it("is refused rather than stored as an empty success", async () => {
    // Zero bytes and "we read it and it was blank" are different facts about a document.
    const { spawn, calls } = spawnAnswering(A_PAGE);

    const result = await extract(spawn, { bytes: new Uint8Array() });

    expect(result.reason).toBe(EMPTY_SOURCE);
    expect(calls).toHaveLength(0);
  });
});

describe("text past the ceiling", () => {
  it("is cut and SAYS it was cut", async () => {
    // A cut document that does not say so reads as a complete one lacking the clause you
    // were looking for. The bytes stay whole in the lake either way.
    const { spawn } = spawnAnswering("x".repeat(MAX_TEXT_CHARS + 500));

    const result = await extract(spawn);

    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(MAX_TEXT_CHARS);
  });

  it("leaves an ordinary document unmarked", async () => {
    // The quiet side: a flag that is always set says nothing.
    const { spawn } = spawnAnswering(A_PAGE);

    expect((await extract(spawn)).truncated).toBe(false);
  });
});

describe("the child's deadline", () => {
  it("is passed to every program, so a hung one cannot hold the run open", async () => {
    let seen = 0;
    const spawn: Spawn = (_cmd, options) => {
      seen = options.timeoutMs;
      return Promise.resolve({ exitCode: 0, output: A_PAGE });
    };

    await extract(spawn);

    expect(seen).toBe(DEFAULT_EXTRACT_TIMEOUT_MS);
  });
});
