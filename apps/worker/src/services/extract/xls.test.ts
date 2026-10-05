/**
 * What the Excel 97–2003 reader promises: an `.xls` comes back as the same sheets of rows an
 * `.xlsx` gives -- names, row numbers, column letters, the facts Excel stores -- with every number
 * the digits of the double Excel stored and never a float carried through arithmetic, and a
 * locked or broken workbook refused by name. ADR 0104 decision 7.
 *
 * Every workbook is written by `xlsOf` as Excel writes one: BIFF8 records in a `Workbook` stream
 * inside a compound file. Nothing binary is committed (`pii.md`: invented values throughout).
 */

import { describe, expect, test as it } from "bun:test";

import { type BiffCell, xlsOf } from "./biffTesting.ts";
import { cfbOf } from "./cfbTesting.ts";
import type { Extracted } from "./extracted.ts";
import { extractDocument } from "./extractText.ts";
import type { Spawn } from "../transform.ts";
import { WORKBOOK_PASSWORD_PROTECTED, XLS_BIFF5, XLS_UNREADABLE } from "./spreadsheet.ts";

const XLS = "application/vnd.ms-excel";
const spawnNothing: Spawn = () => Promise.reject(new Error("no binary should be spawned"));

function extract(bytes: Uint8Array): Promise<Extracted> {
  return extractDocument(
    { spawn: spawnNothing, workDir: "/tmp/xls-test" },
    { contentType: XLS, bytes, path: "/tmp/xls-test/doc" },
  );
}

async function firstRows(result: Extracted, sheet = 0): Promise<unknown[]> {
  const rows = await Array.fromAsync(result.workbook?.sheets[sheet]?.rows() ?? []);
  return rows.map((row) => [row.rowNumber, row.cells, row.faults]);
}

/** An RK holding a 30-bit integer, optionally ×1/100 (§2.5.217), as its unsigned 32 bits. */
function rkInteger(value: number, hundredths = false): number {
  const UINT32 = 2 ** 32;
  return (value * 4 + 2 + (hundredths ? 1 : 0) + UINT32) % UINT32;
}

describe("an Excel 97-2003 workbook", () => {
  it("is read as sheets of rows, each value under its column letter and Excel's row number", async () => {
    const bytes = xlsOf({
      shared: ["Invoice", "Acme Holdings"],
      sheets: [
        {
          name: "Ledger",
          cells: [
            { row: 0, col: 0, sst: 0 },
            { row: 0, col: 2, sst: 1 },
            { row: 4, col: 1, label: "Ghi chú" },
          ],
        },
        { name: "Summary", cells: [{ row: 0, col: 0, label: "Totals" }] },
      ],
    });

    const result = await extract(bytes);

    expect([
      result.method,
      result.workbook?.container,
      result.workbook?.sheets.map((s) => s.name),
    ]).toEqual(["xls", "biff8", ["Ledger", "Summary"]]);
    expect(await firstRows(result)).toEqual([
      [1, { A: "Invoice", C: "Acme Holdings" }, null],
      [5, { B: "Ghi chú" }, null],
    ]);
  });

  it("keeps every number as the digits of the double Excel stored, and divides an RK by 100 exactly", async () => {
    // money.md: the double IS the file's value; rendered once, never through arithmetic. An RK
    // ×1/100 is a shift of digits: as a float division, the double 1.0141639709472656 / 100
    // would round a second time and print 0.010141639709472657.
    const cells: BiffCell[] = [
      { row: 0, col: 0, number: 0.1 },
      { row: 0, col: 1, number: 1234.1 },
      { row: 0, col: 2, rk: rkInteger(42) },
      { row: 0, col: 3, rk: rkInteger(123_456, true) },
      { row: 0, col: 4, rk: 0x3f_f0_3a_05 },
      { row: 0, col: 5, rk: rkInteger(-7) },
    ];

    const result = await extract(xlsOf({ sheets: [{ name: "Ledger", cells }] }));

    expect(await firstRows(result)).toEqual([
      [
        1,
        { A: "0.1", B: "1234.1", C: "42", D: "1234.56", E: "0.010141639709472656", F: "-7" },
        null,
      ],
    ]);
  });

  it("reads a shared string that runs into the next record, its characters changing width there", async () => {
    // A string split across SST and CONTINUE restates its flags at the split; reading past
    // that byte would shift every string after it.
    const bytes = xlsOf({
      shared: [{ head: "Total ", tail: "Tiền thanh toán" }, "Acme"],
      sheets: [
        {
          name: "Ledger",
          cells: [
            { row: 0, col: 0, sst: 0 },
            { row: 0, col: 1, sst: 1 },
          ],
        },
      ],
    });

    expect(await firstRows(await extract(bytes))).toEqual([
      [1, { A: "Total Tiền thanh toán", B: "Acme" }, null],
    ]);
  });

  it("keeps errors apart from values, and reads a formula's cached result of every kind", async () => {
    const cells: BiffCell[] = [
      { row: 0, col: 0, error: 0x17 },
      { row: 0, col: 1, bool: true },
      { row: 0, col: 2, formulaNumber: 99.5 },
      { row: 0, col: 3, formulaString: "Acme" },
      { row: 0, col: 4, formulaError: 0x07 },
    ];

    const result = await extract(xlsOf({ sheets: [{ name: "Ledger", cells }] }));

    expect(await firstRows(result)).toEqual([
      [1, { B: "1", C: "99.5", D: "Acme" }, { A: "#REF!", E: "#DIV/0!" }],
    ]);
  });

  it("records formats, merges, hidden rows, hidden sheets and the 1904 epoch, acting on none", async () => {
    const bytes = xlsOf({
      date1904: true,
      formats: [[164, "dd/mm/yyyy"]],
      xfs: [0, 164, 14],
      sheets: [
        {
          name: "Helper",
          state: 1,
          hiddenRows: [1],
          merges: [[0, 0, 0, 5]],
          cells: [
            { row: 0, col: 0, number: 46_286, xf: 1 },
            { row: 1, col: 0, number: 46_287, xf: 2 },
          ],
        },
      ],
    });

    const result = await extract(bytes);
    const [helper] = result.workbook?.sheets ?? [];
    const rows = await Array.fromAsync(helper?.rows() ?? []);

    expect([result.workbook?.date1904, helper?.state, helper?.merges, helper?.dimension]).toEqual([
      true,
      "hidden",
      ["A1:F1"],
      "A1:A2",
    ]);
    expect(rows.map((row) => [row.rowNumber, row.hidden, row.formats])).toEqual([
      [1, false, { A: "dd/mm/yyyy" }],
      [2, true, { A: "builtin:14" }],
    ]);
  });
});

describe("an Excel 97-2003 workbook that cannot be read", () => {
  it("is refused as locked when it was saved with a password", async () => {
    const bytes = xlsOf({
      password: true,
      sheets: [{ name: "Ledger", cells: [{ row: 0, col: 0, number: 1 }] }],
    });

    expect((await extract(bytes)).reason).toBe(WORKBOOK_PASSWORD_PROTECTED);
  });

  it("is refused as unreadable when its records break off, never read as a shorter workbook", async () => {
    const broken = cfbOf([
      { name: "Root Entry", type: 5, child: 1 },
      { name: "Workbook", type: 2, bytes: new TextEncoder().encode("not BIFF records") },
    ]);

    expect((await extract(broken)).reason).toBe(XLS_UNREADABLE);
  });

  it("is refused by a name of its own when it is older than Excel 97", async () => {
    const biff5 = cfbOf([
      { name: "Root Entry", type: 5, child: 1 },
      { name: "Book", type: 2, bytes: new TextEncoder().encode("BIFF5 records") },
    ]);

    expect((await extract(biff5)).reason).toBe(XLS_BIFF5);
  });
});
