/**
 * What the spreadsheet reader promises: a workbook's words come back readable, its amounts
 * come back EXACTLY as the file wrote them, and bytes nobody can open are refused by name.
 *
 * No mocks and no committed binary fixture. Each test builds a real `.xlsx` -- a genuine zip
 * with local headers, a central directory, an end record and CRCs, holding genuine OOXML --
 * so the reader is exercised against the format rather than against a stand-in for it. That
 * is `tests.md`'s "real in-memory implementations over fakes-that-always-answer": a hand-made
 * object that skipped the container would make a broken zip parser look fine.
 *
 * Both compression methods appear below because both appear in the wild: Excel deflates, and
 * plenty of writers store small parts. `zipOf` is in `testing.ts`, shared with the `.docx`
 * suite, which needs the same real container around different parts.
 */

import { describe, expect, test as it } from "bun:test";
import type { Spawn } from "../transform.ts";
import { type Extracted, extractDocument, LEGACY_XLS, XLSX_UNREADABLE } from "./extractText.ts";
import { type ZipMember, zipOf } from "./testing.ts";
import { readXlsx } from "./xlsx.ts";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const utf8 = new TextEncoder();

function sheet(rows: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;
}

function strings(items: readonly string[]): string {
  return `<sst>${items.map((item) => `<si><t>${item}</t></si>`).join("")}</sst>`;
}

/** Invented throughout, per `pii.md`: Acme, and an amount with a decimal that floats round. */
const SHARED = ["Invoice", "Acme Holdings", "Tiền thanh toán"];

const ONE_SHEET = sheet(
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>1234.10</v></c></row>' +
    '<row r="3"><c r="A3" t="inlineStr"><is><t>Ghi chú &amp; điều khoản</t></is></c></row>',
);

function workbook(
  sheets: readonly ZipMember[] = [{ name: "xl/worksheets/sheet1.xml", body: ONE_SHEET }],
) {
  return zipOf([
    { name: "[Content_Types].xml", body: "<Types/>", stored: true },
    { name: "xl/sharedStrings.xml", body: strings(SHARED) },
    ...sheets,
  ]);
}

const spawnNothing: Spawn = () => Promise.reject(new Error("no binary should be spawned"));

function extract(bytes: Uint8Array, contentType = XLSX_TYPE): Promise<Extracted> {
  return extractDocument(
    { spawn: spawnNothing, workDir: "/tmp/xlsx-test" },
    { contentType, bytes, path: "/tmp/xlsx-test/doc" },
  );
}

describe("a workbook's amounts", () => {
  it("come back as the digits the file wrote, never through a float", () => {
    // The regression this reader exists to not have. `Number("1234.10")` is 1234.0999999...,
    // and money.md is explicit that such a value arrives downstream looking like a fact.
    const text = readXlsx(workbook());

    expect(text).toContain("1234.10");
    expect(text).not.toContain("1234.0999");
  });
});

describe("a workbook's words", () => {
  it("resolve through the shared string table, in the operators' own language", () => {
    const text = readXlsx(workbook());

    expect(text).toContain("Tiền thanh toán");
    expect(text).toContain("Acme Holdings");
  });

  it("include a cell that carries its own text instead of a table index", () => {
    // An inline string is a different branch of the cell grammar, and a workbook written by
    // something other than Excel is often entirely inline.
    expect(readXlsx(workbook())).toContain("Ghi chú & điều khoản");
  });

  it("arrive in reading order, cells across and rows down", () => {
    const text = readXlsx(workbook());

    expect(text).toContain("Invoice\tTiền thanh toán\nAcme Holdings\t1234.10");
  });
});

describe("a workbook of several sheets", () => {
  it("reads them in numeric order, so the tenth follows the ninth", () => {
    const bytes = workbook([
      {
        name: "xl/worksheets/sheet10.xml",
        body: sheet('<row><c t="inlineStr"><is><t>tenth</t></is></c></row>'),
      },
      {
        name: "xl/worksheets/sheet2.xml",
        body: sheet('<row><c t="inlineStr"><is><t>second</t></is></c></row>'),
      },
    ]);

    const text = readXlsx(bytes) ?? "";

    expect(text.indexOf("second")).toBeLessThan(text.indexOf("tenth"));
  });
});

describe("bytes that are not a workbook we can open", () => {
  it("are refused by name, never stored as a spreadsheet that says nothing", () => {
    // The whole of CLAUDE.md rule 2 in one assertion: an empty string here is indistinguishable
    // downstream from a genuinely blank workbook.
    expect(readXlsx(utf8.encode("<html>Sign in to continue</html>"))).toBeNull();
  });

  it("include a zip holding no worksheet at all, such as a document renamed", () => {
    expect(readXlsx(zipOf([{ name: "word/document.xml", body: "<w:document/>" }]))).toBeNull();
  });

  it("stay quiet for a workbook that IS readable", () => {
    // The other half of the guard: a rule with only its firing case is satisfied by code
    // that always refuses (`tests.md`).
    expect(readXlsx(workbook())).not.toBeNull();
  });
});

describe("the extract dispatch", () => {
  it("reads a spreadsheet in process, spawning no binary", async () => {
    const result = await extract(workbook());

    expect(result.method).toBe("xlsx");
    expect(result.text).toContain("Acme Holdings");
  });

  it("refuses an unopenable spreadsheet with its own reason", async () => {
    const result = await extract(utf8.encode("not a zip"));

    expect(result.method).toBeNull();
    expect(result.reason).toBe(XLSX_UNREADABLE);
  });

  it("refuses the pre-2007 binary workbook by a reason of its own", async () => {
    // Not `legacy-doc-unsupported`: an operator reading the ledger should not have to know
    // that the Word reason was meant to cover spreadsheets too.
    const result = await extract(workbook(), "application/vnd.ms-excel");

    expect(result.reason).toBe(LEGACY_XLS);
  });
});
