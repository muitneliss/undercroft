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
  type SheetState,
} from "./workbookPackage.ts";
import { lettersOf, type ScannedRow } from "./sheetCells.ts";
import { SHEET_UNREADABLE, type SheetEnd, scanSheet } from "./sheetScan.ts";

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
  /** The sheet's rows, streamed afresh on each call so no sheet is ever held whole. */
  readonly rows: () => AsyncIterable<SheetRow>;
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

/** Why a sheet listed past `MAX_SHEETS` is not read. A scan names its own (`sheetScan.ts`). */
export const SHEETS_LIMIT = "sheets-limit";

const CELL_SEPARATOR = "\t";
const ROW_SEPARATOR = "\n";
const SHEET_SEPARATOR = "\n\n";

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

/**
 * A sheet as a container presents it: its facts, and a way to scan its rows afresh. The
 * OOXML package is one container (`readWorkbook` below), a BIFF8 stream another (`biff8.ts`);
 * everything a workbook becomes from there -- its rows, its text, its outcome -- is one code
 * path for both, so the two cannot disagree about what a sheet is.
 */
export interface SheetSource {
  readonly index: number;
  readonly name: string | null;
  readonly nameReason: string | null;
  readonly kind: SheetKind | null;
  readonly state: SheetState;
  /**
   * `null` when the container holds no part for this sheet. A stream is read as it inflates
   * (async); a BIFF8 sheet is already in memory (sync). Both are read the same way below.
   */
  readonly scan:
    | (() => AsyncGenerator<ScannedRow, SheetEnd> | Generator<ScannedRow, SheetEnd>)
    | null;
}

async function* sheetRows(scan: NonNullable<SheetSource["scan"]>): AsyncGenerator<SheetRow> {
  for await (const row of scan()) {
    yield sheetRowOf(row);
  }
}

/** A sheet that is listed and not read: no rows, and why. */
function unread(reason: string): Omit<Sheet, keyof SheetSource> {
  return {
    dimension: null,
    merges: [],
    rowCount: 0,
    complete: false,
    reason,
    async *rows(): AsyncGenerator<SheetRow> {
      // Nothing was read, so there is nothing to yield.
    },
  };
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

/** Scans a sheet once for its text and its end; `rows` scans it again on demand. */
async function readSheet(source: SheetSource, text: BoundedText): Promise<Sheet> {
  const facts = {
    index: source.index,
    name: storableOrNull(source.name),
    nameReason: source.nameReason,
    kind: source.kind,
    state: source.state,
  };
  const { scan } = source;
  if (scan === null || source.index > MAX_SHEETS) {
    return { ...facts, ...unread(scan === null ? SHEET_UNREADABLE : SHEETS_LIMIT) };
  }
  const lines = scan();
  let rowCount = 0;
  let step = await lines.next();
  while (step.done !== true) {
    text.add(`${rowCount === 0 ? "" : ROW_SEPARATOR}${lineOf(step.value)}`);
    rowCount += 1;
    step = await lines.next();
  }
  const end: SheetEnd = step.value;
  return {
    ...facts,
    ...end,
    dimension: storableOrNull(end.dimension),
    merges: end.merges.map(storable),
    rowCount,
    rows: () => sheetRows(scan),
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
export async function readWorkbook(
  bytes: Uint8Array,
  textLimit: number,
): Promise<WorkbookReading | null> {
  const opened = await openWorkbookPackage(bytes);
  if (opened === null) {
    return null;
  }
  const sources = opened.sheets.map((part): SheetSource => {
    const { stream } = part;
    return { ...part, scan: stream === null ? null : () => scanSheet(stream, opened) };
  });
  return await assembleWorkbook(opened, sources, textLimit);
}

/**
 * A workbook from its sheets: each scanned once for the text and its outcome, in tab order and
 * one at a time, so the text is the sheets in order and a workbook's memory is one sheet's scan.
 * `null` when no sheet could be read at all -- a workbook with none readable is not an empty one.
 */
export async function assembleWorkbook(
  head: Pick<Workbook, "container" | "date1904">,
  sources: readonly SheetSource[],
  textLimit: number,
): Promise<WorkbookReading | null> {
  if (sources.every((source) => source.scan === null)) {
    return null;
  }
  const text = new BoundedText(textLimit);
  const sheets: Sheet[] = [];
  for (const source of sources) {
    if (source.index > 1) {
      text.add(SHEET_SEPARATOR);
    }
    sheets.push(await readSheet(source, text));
  }
  if (sheets.every((sheet) => sheet.reason === SHEET_UNREADABLE)) {
    return null;
  }
  return {
    workbook: { container: head.container, date1904: head.date1904, sheets },
    text: text.toString(),
    short: sheets.some((sheet) => !sheet.complete),
  };
}
