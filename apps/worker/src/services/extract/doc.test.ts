/**
 * What the legacy Word reader promises: a Word 97 document's text arrives, wherever in the
 * file the document chose to keep it, and a file it cannot read exactly is refused by a name
 * that says what an operator can do about it.
 *
 * No mocks and no committed binary: `docOf` writes a real compound file -- FAT, mini stream,
 * directory tree, FIB, piece table and a page of paragraph properties -- and LibreOffice reads
 * what it writes, tables included. Fixtures are invented per `pii.md`, and Vietnamese is a
 * first-class case because 17% of the corpus carries it.
 */

import { describe, expect, test as it } from "bun:test";

import type { Spawn } from "../transform.ts";
import { type DocParagraph, docOf } from "./docTesting.ts";
import {
  DOC_PASSWORD_PROTECTED,
  DOC_UNREADABLE,
  type Extracted,
  extractDocument,
  LEGACY_DOC,
} from "./extractText.ts";

/** Nothing here starts a program; a spawn that refuses would say so if one were started. */
const noProgram: Spawn = () => Promise.reject(new Error("the .doc reader starts no program"));

function extract(bytes: Uint8Array): Promise<Extracted> {
  return extractDocument(
    { spawn: noProgram, workDir: "/tmp/doc-test" },
    { contentType: "application/msword", bytes, path: "/tmp/doc-test/doc" },
  );
}

/** A two-column table as Word stores it: a mark after every cell, and one more for the row. */
function table(rows: readonly (readonly string[])[]): DocParagraph[] {
  return rows.flatMap((cells) => [
    ...cells.map((text): DocParagraph => ({ text, ends: "cell" })),
    { text: "", ends: "row" },
  ]);
}

describe("a Word 97 document", () => {
  it("is read as its text, Vietnamese included", async () => {
    const result = await extract(
      docOf([{ text: "Hợp đồng dịch vụ số 12/2026" }, { text: "Bên A: Acme Holdings" }]),
    );

    expect(result).toEqual({
      method: "doc",
      reason: null,
      text: "Hợp đồng dịch vụ số 12/2026\nBên A: Acme Holdings",
      truncated: false,
    });
  });

  it("decodes a one-byte piece as Windows-1252, the encoding the format fixes for it", async () => {
    // Word stores a run of text that fits in one byte a character. Curly quotes sit in the
    // 0x80-0x9F range where Windows-1252 and Latin-1 disagree, so a Latin-1 decode would turn
    // them into invisible control characters.
    const result = await extract(
      docOf([{ text: "“Acme” café", compressed: true }, { text: "Tiền thanh toán" }]),
    );

    expect(result.text).toBe("“Acme” café\nTiền thanh toán");
  });

  it("keeps a table's rows on their own lines and its cells apart", async () => {
    // A cell and a row both end with the same character; only a paragraph property tells
    // them apart. The empty first cell of the second row keeps its place, because which
    // column a value sat in is part of what the table says.
    const result = await extract(
      docOf([
        ...table([
          ["Khách hàng", "Acme Holdings"],
          ["", "1.000.000"],
        ]),
        { text: "Sau bảng" },
      ]),
    );

    expect(result.text).toBe("Khách hàng | Acme Holdings\n | 1.000.000\nSau bảng");
  });

  it("reads a text box, which Word stores outside the body", async () => {
    // The fee a Vietnamese contract puts in a text box: the shape `docx.ts` records a sibling
    // reader losing. Here it lies past the body's character count, where a body-only read
    // would stop.
    const result = await extract(
      docOf([{ text: "Điều 3. Phí dịch vụ" }], {
        textBoxes: [{ text: "Phí dịch vụ: 5.000.000 VND" }],
      }),
    );

    expect(result.text).toBe("Điều 3. Phí dịch vụ\nPhí dịch vụ: 5.000.000 VND");
  });

  it("does not glue a field's instruction to its result", async () => {
    // `begin instruction separator result end`, with nothing between the instruction and the
    // separator: dropping the separator would invent the token `"https://example.test"Acme`.
    const hyperlink = '\u0013HYPERLINK "https://example.test"\u0014Acme\u0015 site';

    expect((await extract(docOf([{ text: hyperlink }]))).text).toBe(
      'HYPERLINK "https://example.test" Acme site',
    );
  });

  it("reads its own text, not the text of a document embedded in it", async () => {
    // The embedded `WordDocument` comes first in the directory, so a reader that searched the
    // whole directory by name rather than the root's children would answer with it.
    const result = await extract(
      docOf([{ text: "Hợp đồng chính" }], { embedded: [{ text: "Phụ lục nhúng" }] }),
    );

    expect(result.text).toBe("Hợp đồng chính");
  });

  it("reads a document too large for the mini stream", async () => {
    // Under 4 KiB a stream lives in the mini stream; past it, in the file's own sectors.
    const long = "Acme Holdings thanh toán theo tháng. ".repeat(200);

    expect((await extract(docOf([{ text: long.trim() }]))).text).toBe(long.trim());
  });
});

describe("a .doc that cannot be read exactly", () => {
  it("is refused by the legacy name when it is older than Word 97", async () => {
    // Word 95's one-byte text is in whatever codepage wrote it; decoding it anyway would
    // return confident Latin letters that were never in a Vietnamese document.
    const result = await extract(docOf([{ text: "Acme" }], { nFib: 0x68 }));

    expect(result).toMatchObject({ method: null, reason: LEGACY_DOC, text: "" });
  });

  it("is refused as password-protected when the sender locked it", async () => {
    const result = await extract(docOf([{ text: "Acme" }], { encrypted: true }));

    expect(result).toMatchObject({ method: null, reason: DOC_PASSWORD_PROTECTED, text: "" });
  });

  it("is refused as unreadable when it is not a compound file at all", async () => {
    // What a sync collects when a sign-in page arrives under the Word type.
    const result = await extract(new TextEncoder().encode("<html>Sign in</html>"));

    expect(result).toMatchObject({ method: null, reason: DOC_UNREADABLE, text: "" });
  });

  it("is refused, and the read returns, when a sector chain loops", async () => {
    // A chain that points back at itself would never end; the reader must notice the loop.
    const bytes = docOf([{ text: "x".repeat(5000) }]);
    const fat = new DataView(bytes.buffer, 512, 512);
    for (let sector = 0; sector < 128; sector += 1) {
      if (fat.getUint32(sector * 4, true) < 0xff_ff_ff_fa) {
        fat.setUint32(sector * 4, sector, true);
      }
    }

    expect((await extract(bytes)).reason).toBe(DOC_UNREADABLE);
  });
});
