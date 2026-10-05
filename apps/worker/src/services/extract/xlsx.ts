/**
 * What a spreadsheet says: its sheets as rows of cells, and the same rows as text.
 *
 * `workbookPackage.ts` finds the parts and `zip.ts` opens the container; this reads the sheets.
 * ONE PARSE, TWO OUTPUTS: the rows a dbt model selects (`raw.document_rows`, ADR 0104) and the
 * tab-separated text search indexes (`raw.document_text`) come from the same scan, so the two
 * can never disagree about what a workbook holds.
 *
 * CELL VALUES STAY STRINGS, EXACTLY AS THE FILE WROTE THEM. This is `money.md`, and a
 * spreadsheet is the single likeliest document in the platform to be full of amounts: the
 * moment a cell becomes a JavaScript `number` it is a float, and `1234.10` arrives downstream
 * as `1234.0999999999999`. Nothing here parses a value.
 *
 * FACTS ARE RECORDED AND NOTHING IS INTERPRETED (ADR 0104 decision 2). A date stays its serial
 * beside the workbook's `date1904` flag and the cell's number-format code; a merged range is
 * listed, never filled; a hidden row is flagged, never dropped; no header is chosen. An Excel
 * error (`#REF!`) and a formula written without its result are FAULTS, kept apart from values,
 * so a model casting a column reads NULL rather than mistaking `#REF!` for a word.
 *
 * WHAT IT DOES NOT READ: charts, pivot caches, comments, and the formula behind a cell. A
 * formula's *result* is what the cell says; its source is a different document.
 */

import {
  type Container,
  openWorkbookPackage,
  type SheetKind,
  type SheetPart,
  type SheetState,
  type WorkbookPackage,
} from "./workbookPackage.ts";
import { lettersOf, type ScannedRow, scanSheet, stopped } from "./sheetScan.ts";
import { attributesOf, PREFIX } from "./xml.ts";

export type { Container, SheetKind, SheetState } from "./workbookPackage.ts";

/** One non-empty row, its cells keyed by column letter. Every map is sparse. */
export interface SheetRow {
  /** Excel's own row number; the gaps between two rows are real. */
  readonly rowNumber: number;
  readonly hidden: boolean;
  /** Column letter → the string the file stores. */
  readonly cells: Readonly<Record<string, string>>;
  /** Column letter → number-format code, for a cell whose format is not General. */
  readonly formats: Readonly<Record<string, string>> | null;
  /** Column letter → what stands where a value would: `#REF!`, `formula-uncached`. */
  readonly faults: Readonly<Record<string, string>> | null;
}

export interface Sheet {
  readonly index: number;
  readonly name: string | null;
  readonly nameReason: string | null;
  readonly kind: SheetKind | null;
  readonly state: SheetState;
  /** The used range the sheet declares, such as `A1:K5012`, or `null` when it declares none. */
  readonly dimension: string | null;
  /** Merged ranges as declared, such as `A1:F1`. Never filled. */
  readonly merges: readonly string[];
  /** Non-empty rows `rows` yields. */
  readonly rowCount: number;
  /** `false` when the read stopped short; `reason` says why, and `rows` holds what came before. */
  readonly complete: boolean;
  readonly reason: string | null;
  /** The sheet's rows, scanned afresh on each call so no sheet is ever held as an array. */
  readonly rows: () => Iterable<SheetRow>;
}

export interface Workbook {
  readonly container: Container;
  readonly date1904: boolean | null;
  readonly sheets: readonly Sheet[];
}

export interface WorkbookReading {
  readonly workbook: Workbook;
  /** The sheets as text: cells across by tab, rows down by line, sheets by a blank line. */
  readonly text: string;
  /** `true` when a sheet is incomplete, so the text is shorter than the workbook. */
  readonly short: boolean;
}

/** A sheet listed past this is recorded and not read (ADR 0104 decision 11). */
export const MAX_SHEETS = 256;

/** Why a whole sheet is incomplete. A scan that stops part-way names its own (`sheetScan.ts`). */
export const SHEET_UNREADABLE = "sheet-unreadable";
export const SHEETS_LIMIT = "sheets-limit";

const CELL_SEPARATOR = "\t";
const ROW_SEPARATOR = "\n";
const SHEET_SEPARATOR = "\n\n";
const DIMENSION = new RegExp(`<${PREFIX}dimension\\b(?<attributes>[^>]*?)\\/?>`, "u");
const MERGE = new RegExp(`<${PREFIX}mergeCell\\b(?<attributes>[^>]*?)\\/?>`, "gu");

/**
 * U+0000 made storable: neither a Postgres `text` column nor a `jsonb` string can hold it. It is
 * replaced by the character a non-fatal decode writes for a byte that is not text, exactly as
 * `read` in `extractText.ts` does for a document's text (issue #218), and for the same reason:
 * one unstorable value would fail the statement that carries a whole batch.
 */
function storable(value: string): string {
  return value.replaceAll("\u0000", "\uFFFD");
}

function storableOrNull(value: string | null): string | null {
  return value === null ? null : storable(value);
}

function sheetRowOf(row: ScannedRow): SheetRow {
  const cells: Record<string, string> = {};
  const formats: Record<string, string> = {};
  const faults: Record<string, string> = {};
  for (const entry of row.entries) {
    const letters = lettersOf(entry.column);
    if (entry.value !== null) {
      cells[letters] = storable(entry.value);
    }
    if (entry.format !== null) {
      formats[letters] = storable(entry.format);
    }
    if (entry.fault !== null) {
      faults[letters] = storable(entry.fault);
    }
  }
  return {
    rowNumber: row.rowNumber,
    hidden: row.hidden,
    cells,
    formats: Object.keys(formats).length > 0 ? formats : null,
    faults: Object.keys(faults).length > 0 ? faults : null,
  };
}

/**
 * A row as a line of text, every gap kept so a column stays a column. An Excel error is text a
 * reader would see on the sheet; an uncached formula or a missing shared string shows nothing.
 */
function lineOf(row: ScannedRow): string {
  const cells: string[] = [];
  for (const entry of row.entries) {
    while (cells.length < entry.column - 1) {
      cells.push("");
    }
    cells.push(entry.value ?? (entry.fault?.startsWith("#") === true ? entry.fault : ""));
  }
  return cells.join(CELL_SEPARATOR);
}

function* sheetRows(xml: string, workbook: WorkbookPackage): Generator<SheetRow> {
  for (const row of scanSheet(xml, workbook)) {
    yield sheetRowOf(row);
  }
}

/** Text collected up to a ceiling: past it, the scan goes on for its outcome but writes nothing. */
class BoundedText {
  readonly #limit: number;
  readonly #parts: string[] = [];
  #length = 0;

  constructor(limit: number) {
    this.#limit = limit;
  }

  add(part: string): void {
    if (this.#length <= this.#limit) {
      this.#parts.push(part);
      this.#length += part.length;
    }
  }

  toString(): string {
    return this.#parts.join("");
  }
}

/** Scans a sheet once for its text and its outcome; `rows` scans it again on demand. */
function readSheet(part: SheetPart, workbook: WorkbookPackage, text: BoundedText): Sheet {
  const facts = {
    index: part.index,
    name: storableOrNull(part.name),
    nameReason: part.nameReason,
    kind: part.kind,
    state: part.state,
  };
  const { xml } = part;
  if (xml === null || part.index > MAX_SHEETS) {
    const reason = xml === null ? SHEET_UNREADABLE : SHEETS_LIMIT;
    return {
      ...facts,
      dimension: null,
      merges: [],
      rowCount: 0,
      ...stopped(reason),
      rows: () => [],
    };
  }
  const lines = scanSheet(xml, workbook);
  let rowCount = 0;
  let step = lines.next();
  while (step.done !== true) {
    text.add(`${rowCount === 0 ? "" : ROW_SEPARATOR}${lineOf(step.value)}`);
    rowCount += 1;
    step = lines.next();
  }
  return {
    ...facts,
    dimension: storableOrNull(
      attributesOf(DIMENSION.exec(xml)?.groups?.attributes ?? "").get("ref") ?? null,
    ),
    merges: [...xml.matchAll(MERGE)].flatMap((merge) => {
      const ref = attributesOf(merge.groups?.attributes ?? "").get("ref");
      return ref === undefined ? [] : [storable(ref)];
    }),
    rowCount,
    ...step.value,
    rows: () => sheetRows(xml, workbook),
  };
}

/**
 * Read a workbook into sheets of rows and their text, or `null` for bytes that are not a
 * workbook this reader can open.
 *
 * `null` covers a corrupt archive, one that is not a zip at all, a zip holding no sheet -- a
 * `.docx` renamed, say -- and a workbook none of whose sheets could be read. Each is "we could
 * not read this", which the caller records as a reason; none of them is an empty spreadsheet,
 * and this must not return one for them (`CLAUDE.md` rule 2). A workbook with SOME sheets
 * readable is read, and the others say why they are not (`Sheet.reason`).
 *
 * `textLimit` bounds the text held while scanning; the caller caps and flags it exactly.
 */
export function readWorkbook(bytes: Uint8Array, textLimit: number): WorkbookReading | null {
  const opened = openWorkbookPackage(bytes);
  if (opened === null || opened.sheets.every((sheet) => sheet.xml === null)) {
    return null;
  }
  const text = new BoundedText(textLimit);
  const sheets = opened.sheets.map((part) => {
    if (part.index > 1) {
      text.add(SHEET_SEPARATOR);
    }
    return readSheet(part, opened, text);
  });
  return {
    workbook: { container: opened.container, date1904: opened.date1904, sheets },
    text: text.toString(),
    short: sheets.some((sheet) => !sheet.complete),
  };
}
