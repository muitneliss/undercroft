/**
 * What reading a delimited file promises: its text stays the file, and its records become rows
 * by the grammar its type names -- RFC 4180 for `text/csv`, IANA's for `text/tab-separated-values`
 * -- never by a delimiter guessed from the content. ADR 0107.
 *
 * Invented content throughout (`pii.md`).
 */

import { describe, expect, test as it } from "bun:test";

import type { Spawn } from "../transform.ts";
import { CSV_MALFORMED } from "./delimited.ts";
import type { Extracted } from "./extracted.ts";
import { extractDocument } from "./extractText.ts";

const spawnNothing: Spawn = () => Promise.reject(new Error("no binary should be spawned"));

function extract(text: string, contentType = "text/csv"): Promise<Extracted> {
  return extractDocument(
    { spawn: spawnNothing, workDir: "/tmp/csv-test" },
    { contentType, bytes: new TextEncoder().encode(text), path: "/tmp/csv-test/doc" },
  );
}

async function rowsOf(result: Extracted): Promise<unknown[]> {
  const rows = await Array.fromAsync(result.workbook?.sheets[0]?.rows() ?? []);
  return rows.map((row) => [row.rowNumber, row.cells]);
}

describe("a CSV file", () => {
  it("is its records as rows, quoted fields read as RFC 4180 writes them, its text the file", async () => {
    // A comma, a doubled quote and a line break inside quotes are each one field's own; the
    // blank record keeps its number, so the row after it is the fourth.
    const file =
      'Date,Description,Amount\r\n2026-09-21,"Acme, Holdings","1,234.10"\r\n\r\n' +
      '2026-09-22,"He said ""paid""","line one\nline two"\r\n';

    const result = await extract(file);

    expect([result.method, result.text, result.workbook?.container]).toEqual(["txt", file, "csv"]);
    expect(await rowsOf(result)).toEqual([
      [1, { A: "Date", B: "Description", C: "Amount" }],
      [2, { A: "2026-09-21", B: "Acme, Holdings", C: "1,234.10" }],
      [4, { A: "2026-09-22", B: 'He said "paid"', C: "line one\nline two" }],
    ]);
  });

  it("is one field per record when it is separated by semicolons, never a guessed delimiter", async () => {
    // `text/csv` names the comma. A model that knows the file is semicolon-separated splits it.
    const result = await extract("Date;Amount\n2026-09-21;1234.10\n");

    expect(await rowsOf(result)).toEqual([
      [1, { A: "Date;Amount" }],
      [2, { A: "2026-09-21;1234.10" }],
    ]);
  });

  it("stops at a record the grammar has no reading for, keeping the rows before and saying why", async () => {
    const result = await extract('a,b\n"x"y,z\nc,d\n');
    const [sheet] = result.workbook?.sheets ?? [];

    expect([sheet?.complete, sheet?.reason, await rowsOf(result)]).toEqual([
      false,
      CSV_MALFORMED,
      [[1, { A: "a", B: "b" }]],
    ]);
  });
});

describe("a TSV file", () => {
  it("is its lines as rows, split at tabs, a quote being only a character", async () => {
    const result = await extract('Name\tNote\nAcme\t"quoted"\n', "text/tab-separated-values");

    expect([result.workbook?.container, await rowsOf(result)]).toEqual([
      "tsv",
      [
        [1, { A: "Name", B: "Note" }],
        [2, { A: "Acme", B: '"quoted"' }],
      ],
    ]);
  });
});
