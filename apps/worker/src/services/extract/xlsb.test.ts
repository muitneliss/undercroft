/**
 * What the Excel binary workbook reader promises: an `.xlsb` comes back as the same sheets of
 * rows an `.xlsx` gives -- names, tab order, row numbers, column letters, the facts Excel stores
 * -- with every number the digits of the double Excel stored and never a float carried through
 * arithmetic, a sheet that breaks off kept up to the break, and a workbook that cannot be read
 * refused by name. ADR 0109.
 *
 * Every workbook is written by `xlsbOf` as Excel writes one: BIFF12 records in the parts of a
 * genuine zip, found through their relationships. Nothing binary is committed (`pii.md`).
 */

import { describe, expect, test as it } from "bun:test";

import type { Spawn } from "../transform.ts";
import type { Extracted } from "./extracted.ts";
import { extractDocument } from "./extractText.ts";
import { XLSB_UNREADABLE } from "./spreadsheet.ts";
import { type XlsbRow, xlsbOf } from "./xlsbTesting.ts";

const XLSB = "application/vnd.ms-excel.sheet.binary.macroenabled.12";
const spawnNothing: Spawn = () => Promise.reject(new Error("no binary should be spawned"));

function extract(bytes: Uint8Array): Promise<Extracted> {
  return extractDocument(
    { spawn: spawnNothing, workDir: "/tmp/xlsb-test" },
    { contentType: XLSB, bytes, path: "/tmp/xlsb-test/doc" },
  );
}

async function rowsOf(result: Extracted, sheet = 0): Promise<unknown[]> {
  const rows = await Array.fromAsync(result.workbook?.sheets[sheet]?.rows() ?? []);
  return rows.map((row) => [row.rowNumber, row.cells, row.faults]);
}

/** An RK holding a 30-bit integer, optionally ×1/100 ([MS-XLSB] §2.5.123), as its 32 bits. */
function rkInteger(value: number, hundredths = false): number {
  const UINT32 = 2 ** 32;
  return (value * 4 + 2 + (hundredths ? 1 : 0) + UINT32) % UINT32;
}

describe("an Excel binary workbook", () => {
  it("is read as sheets of rows in tab order, every cell under its column as the file stores it", async () => {
    // money.md: the double IS the file's value, rendered once; an RK ×1/100 is a shift of
    // digits -- as a float division 1.0141639709472656 / 100 would print 0.010141639709472657.
    const ledger: XlsbRow[] = [
      {
        row: 0,
        cells: [
          { col: 0, sst: 0 },
          { col: 2, text: "Tiền thanh toán" },
        ],
      },
      {
        row: 1,
        cells: [
          { col: 0, number: 1234.1 },
          { col: 1, rk: rkInteger(123_456, true) },
          { col: 2, rk: 0x3f_f0_3a_05 },
          { col: 3, bool: true },
          { col: 4, error: 0x07 },
          { col: 5, rich: "Acme Pte" },
        ],
      },
      {
        row: 3,
        cells: [
          { col: 0, formulaText: "Acme" },
          { col: 1, formulaNumber: 99.5 },
          { col: 2, formulaBool: false },
          { col: 3, formulaError: 0x17 },
          { col: 4, sst: 9 },
          { col: 5, blank: true },
        ],
      },
    ];
    const bytes = xlsbOf({
      shared: ["Invoice"],
      sheets: [
        { name: "Ledger", rows: ledger },
        { name: "Summary", rows: [{ row: 0, cells: [{ col: 0, text: "Totals" }] }] },
      ],
    });

    const result = await extract(bytes);

    expect([
      result.method,
      result.workbook?.container,
      result.workbook?.sheets.map((sheet) => [sheet.index, sheet.name]),
    ]).toEqual([
      "xlsb",
      "xlsb",
      [
        [1, "Ledger"],
        [2, "Summary"],
      ],
    ]);
    expect(await rowsOf(result)).toEqual([
      [1, { A: "Invoice", C: "Tiền thanh toán" }, null],
      [
        2,
        { A: "1234.1", B: "1234.56", C: "0.010141639709472656", D: "1", F: "Acme Pte" },
        { E: "#DIV/0!" },
      ],
      [4, { A: "Acme", B: "99.5", C: "0" }, { D: "#REF!", E: "shared-string-missing" }],
    ]);
    expect(result.text.startsWith("Invoice\t\tTiền thanh toán\n1234.1\t1234.56")).toBe(true);
  });

  it("records each cell's number format and the 1904 epoch, acting on neither", async () => {
    const bytes = xlsbOf({
      date1904: true,
      formats: [[164, "dd/mm/yyyy"]],
      xfs: [0, 164, 14],
      sheets: [
        {
          name: "Ledger",
          rows: [
            { row: 0, cells: [{ col: 0, number: 46_286, xf: 1 }] },
            { row: 1, cells: [{ col: 0, number: 46_287, xf: 2 }] },
          ],
        },
      ],
    });

    const result = await extract(bytes);
    const rows = await Array.fromAsync(result.workbook?.sheets[0]?.rows() ?? []);

    expect(result.workbook?.date1904).toBe(true);
    expect(rows.map((row) => [row.cells, row.formats])).toEqual([
      [{ A: "46286" }, { A: "dd/mm/yyyy" }],
      [{ A: "46287" }, { A: "builtin:14" }],
    ]);
  });

  it("records a hidden row, a merged range and the declared range, filling and dropping nothing", async () => {
    const bytes = xlsbOf({
      sheets: [
        {
          name: "Ledger",
          merges: [[0, 0, 0, 5]],
          rows: [
            { row: 0, cells: [{ col: 0, text: "Acme Holdings" }] },
            { row: 1, hidden: true, cells: [{ col: 2, number: 7 }] },
          ],
        },
      ],
    });

    const result = await extract(bytes);
    const [ledger] = result.workbook?.sheets ?? [];
    const rows = await Array.fromAsync(ledger?.rows() ?? []);

    expect([ledger?.merges, ledger?.dimension]).toEqual([["A1:F1"], "A1:C2"]);
    expect(rows.map((row) => [row.rowNumber, row.hidden])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("records a hidden and a very hidden sheet's state, and reads them like any other", async () => {
    const cells = [{ col: 0, text: "Acme" }];
    const bytes = xlsbOf({
      sheets: [
        { name: "Ledger", rows: [{ row: 0, cells }] },
        { name: "Helper", state: 1, rows: [{ row: 0, cells }] },
        { name: "Lookup", state: 2, rows: [{ row: 0, cells }] },
      ],
    });

    const result = await extract(bytes);

    expect(
      result.workbook?.sheets.map((sheet) => [sheet.name, sheet.state, sheet.rowCount]),
    ).toEqual([
      ["Ledger", "visible", 1],
      ["Helper", "hidden", 1],
      ["Lookup", "veryHidden", 1],
    ]);
  });

  it("reads a sheet whose records are cut across the pieces it inflates in, each record whole", async () => {
    // A deflated part inflates in pieces of a few kilobytes; at this size records straddle
    // every boundary, and one carried wrongly would shift or lose every row after it.
    const rows = Array.from({ length: 3000 }, (_, at) => ({
      row: at,
      cells: [
        { col: 0, text: `Acme line ${String(at + 1)}` },
        { col: 1, number: at + 0.25 },
      ],
    }));

    const result = await extract(xlsbOf({ sheets: [{ name: "Ledger", rows }] }));
    const [ledger] = result.workbook?.sheets ?? [];
    const read = await Array.fromAsync(ledger?.rows() ?? []);

    expect([ledger?.complete, ledger?.rowCount, read.at(-1)?.cells]).toEqual([
      true,
      3000,
      { A: "Acme line 3000", B: "2999.25" },
    ]);
  });
});

describe("an Excel binary workbook that cannot be read whole", () => {
  it("keeps a broken sheet's rows up to the break and says the sheet is unreadable", async () => {
    // The part ends inside the record after the third row. The rows before that one are
    // whole; the third is not handed on, because a row is only known whole at the next one.
    const rows = [0, 1, 2, 3].map((row) => ({ row, cells: [{ col: 0, number: row + 1 }] }));
    const bytes = xlsbOf({
      sheets: [
        { name: "Ledger", rows, breakAfterRows: 3 },
        { name: "Summary", rows: [{ row: 0, cells: [{ col: 0, text: "Totals" }] }] },
      ],
    });

    const result = await extract(bytes);
    const [ledger, summary] = result.workbook?.sheets ?? [];

    expect([ledger?.complete, ledger?.reason, summary?.complete, result.truncated]).toEqual([
      false,
      "sheet-unreadable",
      true,
      true,
    ]);
    expect(await rowsOf(result)).toEqual([
      [1, { A: "1" }, null],
      [2, { A: "2" }, null],
    ]);
  });

  it("is refused by name when its workbook part breaks off, never read as a shorter workbook", async () => {
    const bytes = xlsbOf({
      brokenWorkbook: true,
      sheets: [{ name: "Ledger", rows: [{ row: 0, cells: [{ col: 0, text: "Acme" }] }] }],
    });

    expect((await extract(bytes)).reason).toBe(XLSB_UNREADABLE);
  });
});
