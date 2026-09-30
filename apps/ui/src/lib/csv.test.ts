/**
 * What the CSV promises: the rows on screen and nothing else, a figure's every digit and its
 * sign, a missing value as an empty field rather than 0, and no text cell that a spreadsheet
 * would run as a formula -- without turning a numeric column's negative amount into text.
 */

import { describe, expect, test as it } from "bun:test";

import type { TableResult } from "@/api/types.ts";
import { resultCsv } from "./csv.ts";

const LEDGER: TableResult = {
  columns: [
    { name: "segment", type: "text" },
    { name: "amount", type: "numeric" },
    { name: "lines", type: "integer" },
    { name: "settled", type: "boolean" },
  ],
  rows: [
    ["=1+1", "-1234.5670", 3, true],
    ['Công ty "An", Hà Nội', null, null, false],
    ["-5", "0.0000", 0, null],
    ["line\nbreak", "12345678901234567890.1234", 1, true],
  ],
  truncated: false,
};

describe("resultCsv", () => {
  it("writes every row's figures as sent, missing as empty, and neutralises only text", () => {
    expect(resultCsv(LEDGER).split("\r\n")).toEqual([
      "segment,amount,lines,settled",
      "'=1+1,-1234.5670,3,true",
      '"Công ty ""An"", Hà Nội",,,false',
      "'-5,0.0000,0,",
      '"line\nbreak",12345678901234567890.1234,1,true',
      "",
    ]);
  });

  it("neutralises a numeric column's cell that is not a plain number", () => {
    const odd: TableResult = {
      columns: [{ name: "amount", type: "numeric" }],
      rows: [["-2+3+cmd|' /C calc'!A0"], ["-0.5"]],
      truncated: false,
    };
    expect(resultCsv(odd)).toBe("amount\r\n'-2+3+cmd|' /C calc'!A0\r\n-0.5\r\n");
  });
});
