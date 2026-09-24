/**
 * What the extractor promises: every document leaves with a method or a reason, and the
 * expensive path is not taken when the cheap one already answered.
 *
 * No mocks. The spawn is a real function that answers the way poppler would, in the shape
 * `transform.test.ts` already established for dbt -- which is what lets the offline gate run
 * this suite with no poppler installed.
 */

import { describe, expect, test as it } from "bun:test";

import { FILE_FORMATS } from "@undercroft/contracts";

import type { Spawn } from "../transform.ts";
import {
  EMPTY_SOURCE,
  extractDocument,
  type Extracted,
  LEGACY_DOC,
  MAX_TEXT_CHARS,
  normalizeText,
  PDF_PASSWORD_PROTECTED,
  TEXT_LAYER_ROUTING_CHARS,
  UNSUPPORTED_TYPE,
} from "./extractText.ts";
// Running a child program, and what an absent one is called, moved to their own module when
// the OCR reader came to need them too -- the assertions below are unchanged.
import { DEFAULT_EXTRACT_TIMEOUT_MS, extractorMissing } from "./program.ts";

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

  it("is not believed when it is only a scan's stray characters", async () => {
    // The firing side, unchanged in substance: a scanned contract still returns a few
    // characters from a stamp, so "the layer returned something" is not "the layer worked",
    // and storing that handful would read downstream as a contract that says almost nothing.
    //
    // What changed is what happens NEXT. This branch used to refuse `needs-ocr`; it now
    // rasterises the page and OCRs it, so the assertion is that the stray characters are not
    // the answer rather than that there is no answer. `ocr.test.ts` pins what comes back.
    const { spawn, calls } = spawnAnswering(SCAN_NOISE);

    const result = await extract(spawn);

    expect(result.method).not.toBe("pdf_text");
    expect(result.text).not.toContain("page 1");
    expect(calls.map((cmd) => cmd[0])).toContain("pdftoppm");
  });

  it("measures the threshold in characters a reader would see, not raw bytes", async () => {
    // Pins the normalisation the threshold depends on. Whitespace-padded noise must not pass
    // by being long; this is the guard that makes the two tests above mean what they say.
    expect(normalizeText(SCAN_NOISE).length).toBeLessThan(TEXT_LAYER_ROUTING_CHARS);
    expect(normalizeText(A_PAGE).length).toBeGreaterThanOrEqual(TEXT_LAYER_ROUTING_CHARS);
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

describe("a password-protected PDF", () => {
  it("is refused as locked rather than as possibly corrupt, and is not sent to OCR", async () => {
    // Regression: six locked email attachments on production were reported `pdftotext-failed`,
    // which the UI words as "the PDF may be corrupt". Poppler exits 1 for both, so what it
    // SAYS is the only difference -- this is the line poppler 25.03 prints.
    const { spawn, calls } = spawnAnswering("\nCommand Line Error: Incorrect password\n", 1);

    const result = await extract(spawn);

    expect(result.reason).toBe(PDF_PASSWORD_PROTECTED);
    expect(result.method).toBeNull();
    expect(calls.map((cmd) => cmd[0])).toEqual(["pdftotext"]);
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

  it("has a reader, or a refusal by name, for every file type the picker offers", async () => {
    // The docs page promises a reading level for each offered format; a format that reached
    // `unsupported-content-type` would make that promise false for every file of it.
    const { spawn } = spawnAnswering(A_PAGE);
    for (const format of FILE_FORMATS) {
      const landed = format.exportAs ?? format.landsAs ?? null;
      for (const contentType of landed === null ? format.mimeTypes : [landed]) {
        const result = await extract(spawn, { contentType });
        expect({ contentType, reason: result.reason }).not.toEqual({
          contentType,
          reason: UNSUPPORTED_TYPE,
        });
      }
    }
  });
});

describe("a saved web page", () => {
  it("is read as the text a reader sees, without its scripts or styles", async () => {
    const { spawn } = spawnAnswering("");
    const page = `<!doctype html><html><head><meta charset="utf-8"><title>Company search</title>
      <style>.uen { color: red }</style><script>var tracking = "abc";</script></head>
      <body><h1>Acme Holdings</h1><table><tr><td>UEN</td><td>209900001A</td></tr></table>
      <p>C&#244;ng ty &amp; &#272;&#7889;i t&#225;c&nbsp;chung</p></body></html>`;

    const result = await extract(spawn, {
      contentType: "text/html",
      bytes: new TextEncoder().encode(page),
    });

    expect(result.method).toBe("html");
    expect(result.text).toContain("Company search");
    expect(result.text).toContain("Acme Holdings");
    expect(result.text).toContain("UEN | 209900001A |");
    expect(result.text).toContain("Công ty & Đối tác chung");
    expect(result.text).not.toContain("tracking");
    expect(result.text).not.toContain("color");
  });
});

describe("a saved email", () => {
  const plain = "Điều khoản thanh toán: 30 ngày.";
  const eml = [
    `Subject: =?utf-8?B?${Buffer.from("Hóa đơn tháng 9").toString("base64")}?=`,
    "From: Billing <billing@acme.test>",
    "To: ops@example.test",
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="b1"',
    "",
    "--b1",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(plain).toString("base64"),
    "--b1",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "<p>HTML copy of the same=",
    " message</p>",
    "--b1--",
    "",
  ].join("\r\n");

  it("is read as its headers and its body, each decoded", async () => {
    const { spawn } = spawnAnswering("");

    const result = await extract(spawn, {
      contentType: "message/rfc822",
      bytes: new TextEncoder().encode(eml),
    });

    expect(result.method).toBe("mime");
    expect(result.text).toContain("Subject: Hóa đơn tháng 9");
    expect(result.text).toContain("From: Billing <billing@acme.test>");
    expect(result.text).toContain(plain);
  });

  it("reads one of two alternatives, so its words are not indexed twice", async () => {
    const { spawn } = spawnAnswering("");

    const result = await extract(spawn, {
      contentType: "message/rfc822",
      bytes: new TextEncoder().encode(eml),
    });

    expect(result.text).not.toContain("HTML copy");
  });
});

describe("a saved web page archive", () => {
  it("is read from its page, soft line breaks undone, its images skipped", async () => {
    const { spawn } = spawnAnswering("");
    const mhtml = [
      "From: <Saved by Blink>",
      "Subject: Business profile",
      'Content-Type: multipart/related; type="text/html"; boundary="----MultipartBoundary"',
      "",
      "------MultipartBoundary",
      "Content-Type: text/html",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      '<html><body><p class=3D"name">Acme Holdings Pte.=',
      " Ltd.</p></body></html>",
      "------MultipartBoundary",
      "Content-Type: image/png",
      "Content-Transfer-Encoding: base64",
      "",
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk",
      "------MultipartBoundary--",
      "",
    ].join("\r\n");

    const result = await extract(spawn, {
      contentType: "multipart/related",
      bytes: new TextEncoder().encode(mhtml),
    });

    expect(result.method).toBe("mime");
    expect(result.text).toContain("Acme Holdings Pte. Ltd.");
    expect(result.text).not.toContain("iVBOR");
  });
});

describe("a delimited file", () => {
  it("is read as the text it is, spawning nothing", async () => {
    // A CSV needs no parser here. Splitting it into rows would mean choosing a delimiter, a
    // quoting style and an encoding the file does not state, for an index that wants the
    // words either way -- three guesses bought with nothing.
    const { spawn, calls } = spawnAnswering("");
    const bytes = new TextEncoder().encode("Khách hàng,Tiền thanh toán\nAcme Holdings,1234.10\n");

    const result = await extract(spawn, { contentType: "text/csv", bytes });

    expect(result.method).toBe("txt");
    expect(result.text).toContain("Acme Holdings,1234.10");
    // The amount is the digits the file wrote, because nothing on this path parses a value.
    expect(result.text).not.toContain("1234.0999");
    expect(calls).toHaveLength(0);
  });

  it("keeps the rest of itself when one byte is not text at all", async () => {
    // The non-fatal decode, which is the whole reason this type reuses the text reader: a
    // stray byte from a mis-encoded export costs that byte and not the document, and lands as
    // a replacement character, which is visibly wrong rather than invisibly absent.
    const { spawn } = spawnAnswering("");
    const bytes = new Uint8Array([
      ...new TextEncoder().encode("Acme Holdings,"),
      0xff,
      ...new TextEncoder().encode(",1234.10"),
    ]);

    const result = await extract(spawn, { contentType: "text/csv", bytes });

    expect(result.method).toBe("txt");
    expect(result.text).toContain("Acme Holdings,");
    expect(result.text).toContain(",1234.10");
  });

  it("includes the tab-separated spelling, which is the same file with another delimiter", async () => {
    const { spawn } = spawnAnswering("");
    const bytes = new TextEncoder().encode("Khách hàng\tTiền thanh toán");

    const result = await extract(spawn, { contentType: "text/tab-separated-values", bytes });

    expect(result.method).toBe("txt");
    expect(result.text).toBe("Khách hàng\tTiền thanh toán");
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
