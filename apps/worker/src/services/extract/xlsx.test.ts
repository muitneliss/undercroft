/**
 * What the spreadsheet reader promises: a workbook's sheets come back as rows with exact column
 * letters, row numbers and sheet names; its amounts come back EXACTLY as the file wrote them;
 * what Excel stores about a cell is recorded and never acted on; and bytes nobody can open are
 * refused by name. ADR 0104.
 *
 * No mocks and no committed binary fixture. Each test builds a real package -- a genuine zip
 * with local headers, a central directory, an end record and CRCs, holding genuine OOXML and
 * its relationships -- so the reader is exercised against the format rather than a stand-in.
 * Everything goes through `extractDocument`, the seam the extract pass calls.
 */

import { describe, expect, test as it } from "bun:test";
import type { Spawn } from "../transform.ts";
import {
  type Extracted,
  extractDocument,
  LEGACY_XLS,
  MAX_TEXT_CHARS,
  XLSX_UNREADABLE,
} from "./extractText.ts";
import { zipOf } from "./testing.ts";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const utf8 = new TextEncoder();

/** Invented throughout, per `pii.md`: Acme, and an amount with a decimal that floats round. */
const SHARED = ["Invoice", "Acme Holdings", "Tiền thanh toán"];

function sheet(rows: string, after = ""): string {
  return `<worksheet xmlns="${MAIN}"><sheetData>${rows}</sheetData>${after}</worksheet>`;
}

interface SheetSpec {
  readonly name: string;
  readonly xml: string | null;
  readonly part?: string;
  readonly state?: string;
}

/** A whole OPC package: the parts found through `_rels`, as Excel and every other writer must. */
function packageOf(
  sheets: readonly SheetSpec[],
  extra: { workbookPr?: string; styles?: string; main?: string; rel?: string } = {},
): Uint8Array {
  const rel = extra.rel ?? REL;
  function partOf(spec: SheetSpec, at: number): string {
    return spec.part ?? `worksheets/sheet${String(at + 1)}.xml`;
  }
  const listed = sheets.map(
    (s, at) =>
      `<sheet name="${s.name}" sheetId="${String(at + 1)}" r:id="rId${String(at + 1)}"${s.state === undefined ? "" : ` state="${s.state}"`}/>`,
  );
  const related = sheets.map(
    (s, at) =>
      `<Relationship Id="rId${String(at + 1)}" Type="${rel}/worksheet" Target="${partOf(s, at)}"/>`,
  );
  return zipOf([
    { name: "[Content_Types].xml", body: "<Types/>", stored: true },
    {
      name: "_rels/.rels",
      body: `<Relationships><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      body: `<workbook xmlns="${extra.main ?? MAIN}" xmlns:r="${rel}">${extra.workbookPr ?? ""}<sheets>${listed.join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      body: `<Relationships>${related.join("")}<Relationship Id="rS" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rT" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "xl/sharedStrings.xml",
      body: `<sst>${SHARED.map((item) => `<si><t>${item}</t></si>`).join("")}</sst>`,
    },
    { name: "xl/styles.xml", body: extra.styles ?? "<styleSheet/>" },
    ...sheets.flatMap((s, at) =>
      s.xml === null ? [] : [{ name: `xl/${partOf(s, at)}`, body: s.xml }],
    ),
  ]);
}

const spawnNothing: Spawn = () => Promise.reject(new Error("no binary should be spawned"));

function extract(bytes: Uint8Array, contentType = XLSX_TYPE): Promise<Extracted> {
  return extractDocument(
    { spawn: spawnNothing, workDir: "/tmp/xlsx-test" },
    { contentType, bytes, path: "/tmp/xlsx-test/doc" },
  );
}

const LEDGER = sheet(
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>1234.10</v></c></row>' +
    '<row r="5"><c r="A5" t="inlineStr"><is><t>Ghi chú &amp; điều khoản</t></is></c></row>',
);

describe("a workbook's rows", () => {
  it("carry each value under its column letter and Excel's own row number", async () => {
    const result = await extract(packageOf([{ name: "Ledger", xml: LEDGER }]));

    const rows = await Array.fromAsync(result.workbook?.sheets[0]?.rows() ?? []);

    expect(rows.map((row) => [row.rowNumber, row.cells])).toEqual([
      [1, { A: "Invoice", B: "Tiền thanh toán" }],
      [2, { A: "Acme Holdings", B: "1234.10" }],
      [5, { A: "Ghi chú & điều khoản" }],
    ]);
  });

  it("keep an amount as the digits the file wrote, never through a float", async () => {
    // `Number("1234.10")` is 1234.0999999..., and money.md is explicit that such a value
    // arrives downstream looking like a fact.
    const result = await extract(packageOf([{ name: "Ledger", xml: LEDGER }]));

    expect(result.text).toContain("Acme Holdings\t1234.10");
  });

  it("keep every later cell in its own column when Excel omits the empty one", async () => {
    // The regression: cells were joined in document order, and Excel writes no element at all
    // for an empty cell, so the amount in C slid left into B's column.
    const result = await extract(
      packageOf([
        {
          name: "Ledger",
          xml: sheet(
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>1234.10</v></c></row>' +
              '<row r="2"><c r="B2" t="s"><v>1</v></c></row>',
          ),
        },
      ]),
    );

    expect(result.text).toBe("Invoice\t\t1234.10\n\tAcme Holdings");
  });

  it("read a sheet whose writer bound SpreadsheetML to a prefix", async () => {
    const prefixed = `<x:worksheet xmlns:x="${MAIN}"><x:sheetData><x:row r="1"><x:c r="B1" t="inlineStr"><x:is><x:t>Acme</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>`;

    const result = await extract(packageOf([{ name: "Ledger", xml: prefixed }]));

    expect((await Array.fromAsync(result.workbook?.sheets[0]?.rows() ?? []))[0]?.cells).toEqual({
      B: "Acme",
    });
  });
});

describe("a workbook's sheets", () => {
  it("are named and ordered as the workbook lists them, wherever their parts live", async () => {
    // A writer may call its parts anything; only the relationships say which is which. The
    // second tab's part is named as if it were the first, and the first's is not Excel's name.
    const summary = sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>Totals</t></is></c></row>');
    const result = await extract(
      packageOf([
        { name: "Summary", xml: summary, part: "sheets/front.xml" },
        { name: "Ledger", xml: LEDGER, part: "worksheets/sheet1.xml" },
      ]),
    );

    const firstCells = await Promise.all(
      (result.workbook?.sheets ?? []).map(async (s) => [
        s.index,
        s.name,
        (await Array.fromAsync(s.rows()))[0]?.cells.A,
      ]),
    );
    expect(firstCells).toEqual([
      [1, "Summary", "Totals"],
      [2, "Ledger", "Invoice"],
    ]);
  });

  it("are read from a Strict package, and say so", async () => {
    const result = await extract(
      packageOf([{ name: "Ledger", xml: LEDGER }], {
        main: "http://purl.oclc.org/ooxml/spreadsheetml/main",
        rel: "http://purl.oclc.org/ooxml/officeDocument/relationships",
      }),
    );

    expect(result.workbook?.container).toBe("ooxml-strict");
  });

  it("carry no name, and say why, when the package has no relationships to follow", async () => {
    // Read the way it always was -- Excel's part names, in numeric order, the tenth after the
    // ninth -- but which tab a part is cannot be known, so the name is not guessed.
    const bytes = zipOf([
      {
        name: "xl/worksheets/sheet10.xml",
        body: sheet('<row><c t="inlineStr"><is><t>tenth</t></is></c></row>'),
      },
      {
        name: "xl/worksheets/sheet2.xml",
        body: sheet('<row><c t="inlineStr"><is><t>second</t></is></c></row>'),
      },
    ]);

    const result = await extract(bytes);

    expect(result.text).toBe("second\n\ntenth");
    expect(result.workbook?.sheets.map((s) => [s.name, s.nameReason])).toEqual([
      [null, "workbook-relationships-missing"],
      [null, "workbook-relationships-missing"],
    ]);
  });

  it("record hidden sheets, hidden rows, merges and the declared range without acting on any", async () => {
    const xml = sheet(
      '<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2" hidden="1"><c r="A2" t="s"><v>1</v></c></row>',
      '<mergeCells count="1"><mergeCell ref="A1:F1"/></mergeCells>',
    ).replace("<sheetData>", '<dimension ref="A1:F2"/><sheetData>');

    const result = await extract(packageOf([{ name: "Helper", xml, state: "hidden" }]));
    const [helper] = result.workbook?.sheets ?? [];

    expect([helper?.state, helper?.dimension, helper?.merges]).toEqual([
      "hidden",
      "A1:F2",
      ["A1:F1"],
    ]);
    expect(
      (await Array.fromAsync(helper?.rows() ?? [])).map((row) => [row.rowNumber, row.hidden]),
    ).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("read the workbook's date epoch", async () => {
    const result = await extract(
      packageOf([{ name: "Ledger", xml: LEDGER }], { workbookPr: '<workbookPr date1904="1"/>' }),
    );

    expect(result.workbook?.date1904).toBe(true);
  });
});

describe("what Excel stores about a cell", () => {
  it("records an error and an uncached formula as faults, never as values", async () => {
    // Read as values, `#REF!` would be a word a model casts, and an uncached formula an empty
    // cell -- indistinguishable from one nobody filled in.
    const xml = sheet(
      '<row r="1"><c r="A1" t="e"><v>#REF!</v></c><c r="B1"><f>SUM(C1:C9)</f></c></row>',
    );

    const result = await extract(packageOf([{ name: "Ledger", xml }]));
    const [row] = await Array.fromAsync(result.workbook?.sheets[0]?.rows() ?? []);

    expect([row?.cells, row?.faults]).toEqual([{}, { A: "#REF!", B: "formula-uncached" }]);
  });

  it("records a cell's number format by its code, and a locale's built-in by its id", async () => {
    // 164 is the workbook's own code; 14 is Excel's short date, which every reader's locale
    // renders its own way, so its code is not invented; 0 is General and not recorded.
    const styles =
      '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>' +
      '<cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs></styleSheet>';
    const xml = sheet(
      '<row r="1"><c r="A1" s="1"><v>46286</v></c><c r="B1" s="2"><v>46287</v></c><c r="C1" s="0"><v>7</v></c></row>',
    );

    const result = await extract(packageOf([{ name: "Ledger", xml }], { styles }));

    expect((await Array.fromAsync(result.workbook?.sheets[0]?.rows() ?? []))[0]?.formats).toEqual({
      A: "dd/mm/yyyy",
      B: "builtin:14",
    });
  });
});

describe("a workbook that cannot be read whole", () => {
  it("is read with the sheet it could not open marked incomplete, and its text marked short", async () => {
    // Refusing the workbook whole hid every sheet it could read behind the one it could not.
    const result = await extract(
      packageOf([
        { name: "Ledger", xml: LEDGER },
        { name: "Archive", xml: null },
      ]),
    );

    expect(result.workbook?.sheets.map((s) => [s.name, s.complete, s.reason])).toEqual([
      ["Ledger", true, null],
      ["Archive", false, "sheet-unreadable"],
    ]);
    expect(result.truncated).toBe(true);
  });

  it("keeps the rows before a cell out of order and says the sheet stops there", async () => {
    // Cells must run left to right; laying out one that does not would be a guess.
    const xml = sheet(
      '<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="C2"><v>1</v></c><c r="B2"><v>2</v></c></row>',
    );

    const result = await extract(packageOf([{ name: "Ledger", xml }]));
    const [ledger] = result.workbook?.sheets ?? [];

    expect([ledger?.complete, ledger?.reason]).toEqual([false, "cells-out-of-order"]);
    expect((await Array.fromAsync(ledger?.rows() ?? [])).map((row) => row.rowNumber)).toEqual([1]);
  });

  it("is never cut as rows when only its text passes the ceiling", async () => {
    // Issue #385: the text a search index holds is capped and says so; the rows a model reads
    // are not, and the sheet is complete. Two thousand rows of 600 characters is 1.2M.
    const filler = "x".repeat(600);
    const rows = Array.from(
      { length: 2000 },
      (_, at) =>
        `<row r="${String(at + 1)}"><c r="A${String(at + 1)}" t="inlineStr"><is><t>${filler}</t></is></c></row>`,
    );

    const result = await extract(packageOf([{ name: "Ledger", xml: sheet(rows.join("")) }]));
    const [ledger] = result.workbook?.sheets ?? [];

    expect([result.truncated, result.text.length]).toEqual([true, MAX_TEXT_CHARS]);
    expect([
      ledger?.complete,
      (await Array.fromAsync(ledger?.rows() ?? [])).at(-1)?.rowNumber,
    ]).toEqual([true, 2000]);
  });
});

describe("a sheet larger than a part could once be", () => {
  it("is read to its last row though its XML inflates past 32 MiB", async () => {
    // ADR 0106: the sheet is streamed, never held whole, so the old ceiling on one inflated
    // part -- which refused such a workbook outright -- no longer stands in front of a sheet.
    const filler = "x".repeat(1000);
    const rows = Array.from(
      { length: 40_000 },
      (_, at) =>
        `<row r="${String(at + 1)}"><c r="A${String(at + 1)}" t="inlineStr"><is><t>${filler}</t></is></c></row>`,
    );
    const result = await extract(packageOf([{ name: "Ledger", xml: sheet(rows.join("")) }]));
    const [ledger] = result.workbook?.sheets ?? [];

    let last = 0;
    for await (const row of ledger?.rows() ?? []) {
      last = row.rowNumber;
    }
    expect([ledger?.complete, ledger?.rowCount, last]).toEqual([true, 40_000, 40_000]);
  });

  it("whose part is corrupt is listed as unreadable while the rest of the workbook is read", async () => {
    const corrupt = zipOf([
      { name: "xl/worksheets/sheet1.xml", body: LEDGER },
      { name: "xl/worksheets/sheet2.xml", body: LEDGER, corrupt: true },
    ]);

    const result = await extract(corrupt);

    expect(result.workbook?.sheets.map((s) => [s.complete, s.reason])).toEqual([
      [true, null],
      [false, "sheet-unreadable"],
    ]);
  });
});

describe("bytes that are not a workbook we can open", () => {
  it("are refused by name, never stored as a spreadsheet that says nothing", async () => {
    // The whole of CLAUDE.md rule 2: an empty string here is indistinguishable downstream from
    // a genuinely blank workbook.
    const result = await extract(utf8.encode("<html>Sign in to continue</html>"));

    expect([result.method, result.reason]).toEqual([null, XLSX_UNREADABLE]);
  });

  it("include a zip holding no sheet at all, such as a document renamed", async () => {
    const result = await extract(zipOf([{ name: "word/document.xml", body: "<w:document/>" }]));

    expect(result.reason).toBe(XLSX_UNREADABLE);
  });

  it("include the pre-2007 binary workbook, by a reason of its own", async () => {
    // Not `legacy-doc-unsupported`: an operator reading the ledger should not have to know
    // that the Word reason was meant to cover spreadsheets too.
    const result = await extract(
      packageOf([{ name: "Ledger", xml: LEDGER }]),
      "application/vnd.ms-excel",
    );

    expect(result.reason).toBe(LEGACY_XLS);
  });
});
