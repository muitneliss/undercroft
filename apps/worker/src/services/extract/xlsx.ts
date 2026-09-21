/**
 * What a spreadsheet says, as text.
 *
 * The OOXML half of the `.xlsx` reader; `zip.ts` is the container half and argues there why
 * neither a converter binary nor an npm dependency is the right shape here.
 *
 * CELL VALUES STAY STRINGS, EXACTLY AS THE FILE WROTE THEM. This is `money.md`, and a
 * spreadsheet is the single likeliest document in the platform to be full of amounts: the
 * moment a cell becomes a JavaScript `number` it is a float, and `1234.10` arrives downstream
 * as `1234.0999999999999`. Nothing here parses a value -- the stored XML digits are copied
 * through verbatim, which is also the only honest thing to do for a column whose type this
 * reader cannot know.
 *
 * FOR THE SAME REASON A DATE IS LEFT AS ITS SERIAL. Excel stores `2026-09-21` as `46286` plus
 * a number format nobody here resolves, and rendering it needs the workbook's format table,
 * the 1900/1904 epoch flag and a timezone this file has no business choosing (`i18n.md` --
 * "never let a locale change a timezone"). A visible `46286` is a value a reader can look up;
 * a guessed date is one they cannot tell from a real one.
 *
 * SHEET NAMES ARE NOT INCLUDED, which is a refusal rather than an omission. A worksheet's
 * name lives in `xl/workbook.xml` and is bound to its part through `xl/_rels/workbook.xml.rels`;
 * without walking both, the mapping from `sheet1.xml` to the first tab is a convention that
 * usually holds, and "usually holds" is the definition of a guess. Sheets are emitted in
 * filename order and the text says which boundary is which.
 *
 * WHAT IT DOES NOT READ: charts, pivot caches, comments, and the formula behind a cell. A
 * formula's *result* is what the cell says; its source is a different document.
 */

import { readZipIndex, readZipText } from "./zip.ts";

const SHARED_STRINGS = "xl/sharedStrings.xml";
const WORKSHEET = /^xl\/worksheets\/sheet(?<index>\d+)\.xml$/u;

/** Cells across, rows down. Tab-separated because a cell's own text may contain a comma. */
const CELL_SEPARATOR = "\t";
const ROW_SEPARATOR = "\n";
const SHEET_SEPARATOR = "\n\n";

/**
 * Phonetic guide text, which duplicates the reading it annotates.
 *
 * Excel writes `<rPh>` inside a shared string to carry furigana over the same characters the
 * `<t>` runs already hold. Collected naively, every such string arrives doubled.
 */
const PHONETIC = /<rPh\b[\s\S]*?<\/rPh>/gu;

/**
 * The element grammar, each written to match a self-closing tag as well as a filled one.
 *
 * `<c r="A1"/>` is a legal empty cell and `<row r="7"/>` a legal empty row, so a pattern that
 * only matched `<x>...</x>` would silently drop the gaps between values and slide a row's
 * columns left. The alternation is what keeps a blank cell blank.
 */
const TEXT_RUN = /<t\b[^>]*?(?:\/>|>(?<body>[\s\S]*?)<\/t>)/gu;
const SHARED_ITEM = /<si\b[^>]*?(?:\/>|>(?<body>[\s\S]*?)<\/si>)/gu;
const SHEET_DATA = /<sheetData\b[^>]*?(?:\/>|>(?<body>[\s\S]*?)<\/sheetData>)/u;
const ROW = /<row\b[^>]*?(?:\/>|>(?<body>[\s\S]*?)<\/row>)/gu;
const CELL = /<c\b(?<attributes>[^>]*?)(?:\/>|>(?<body>[\s\S]*?)<\/c>)/gu;
const VALUE = /<v\b[^>]*?(?:\/>|>(?<body>[\s\S]*?)<\/v>)/u;
const CELL_TYPE = /\bt="(?<type>[^"]*)"/u;

const NAMED_ENTITY: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const ENTITY = /&(?<body>#x?[0-9a-f]+|[a-z]+);/giu;

/**
 * XML entities resolved, including the numeric forms Excel uses for control characters.
 *
 * An entity this function does not recognise is left standing rather than dropped: `&foo;` on
 * the page is visibly odd, where silently deleting it edits the document.
 */
export function decodeXmlText(value: string): string {
  return value.replaceAll(ENTITY, (whole, body: string) => {
    const named = NAMED_ENTITY[body.toLowerCase()];
    if (named !== undefined) {
      return named;
    }
    if (!body.startsWith("#")) {
      return whole;
    }
    const hex = body.startsWith("#x") || body.startsWith("#X");
    // `Number.parseInt`, not `Number()`: a code point is an integer index, not an amount.
    // money.grit's docstring names this exact distinction.
    const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10_ff_ff
      ? String.fromCodePoint(code)
      : whole;
  });
}

/** Every `<t>` run inside one element, joined. A shared string is its runs in order. */
function runsOf(xml: string): string {
  let text = "";
  for (const run of xml.replaceAll(PHONETIC, "").matchAll(TEXT_RUN)) {
    text += decodeXmlText(run.groups?.body ?? "");
  }
  return text;
}

/**
 * The shared string table, by index.
 *
 * Absent from a workbook whose every string is inline, which is not an error -- an empty
 * table simply resolves no `t="s"` cell, and there are none to resolve.
 */
export function sharedStrings(xml: string | null): string[] {
  if (xml === null) {
    return [];
  }
  return [...xml.matchAll(SHARED_ITEM)].map((item) => runsOf(item.groups?.body ?? ""));
}

/**
 * One cell's text.
 *
 * `t="s"` indexes the shared table; `t="inlineStr"` carries its own runs; everything else --
 * a number, a boolean's `0`/`1`, a formula's cached string, an error's `#REF!` -- is the
 * literal contents of `<v>`, copied and not interpreted. See the module docstring.
 */
function cellText(attributes: string, body: string, shared: readonly string[]): string {
  const type = CELL_TYPE.exec(attributes)?.groups?.type ?? "";
  if (type === "inlineStr") {
    return runsOf(body);
  }
  const raw = decodeXmlText(VALUE.exec(body)?.groups?.body ?? "");
  if (type !== "s") {
    return raw;
  }
  const index = Number.parseInt(raw, 10);
  // An index the table cannot answer is left blank rather than filled with the raw number,
  // which would put a row number where a word belongs.
  return shared[index] ?? "";
}

/** One worksheet's rows. An entirely empty row is dropped; a partly empty one keeps its gaps. */
function sheetText(xml: string, shared: readonly string[]): string {
  const data = SHEET_DATA.exec(xml)?.groups?.body ?? "";
  const lines: string[] = [];

  for (const row of data.matchAll(ROW)) {
    const cells = [...(row.groups?.body ?? "").matchAll(CELL)].map((cell) =>
      cellText(cell.groups?.attributes ?? "", cell.groups?.body ?? "", shared),
    );
    if (cells.some((cell) => cell !== "")) {
      lines.push(cells.join(CELL_SEPARATOR));
    }
  }

  return lines.join(ROW_SEPARATOR);
}

/**
 * A workbook's worksheets, in filename order.
 *
 * Numeric order rather than lexicographic, so `sheet10.xml` follows `sheet9.xml` instead of
 * `sheet1.xml`. Ordering is cosmetic for a search index and free to get right here.
 */
function worksheetNames(index: ReadonlyMap<string, unknown>): string[] {
  const sheets: { name: string; at: number }[] = [];
  for (const name of index.keys()) {
    const matched = WORKSHEET.exec(name);
    if (matched !== null) {
      sheets.push({ name, at: Number.parseInt(matched[1] ?? "0", 10) });
    }
  }
  return sheets.sort((a, b) => a.at - b.at).map((sheet) => sheet.name);
}

/**
 * Read a `.xlsx` into text, or `null` if these bytes are not a workbook we can open.
 *
 * `null` covers a corrupt archive, one that is not a zip at all, and a zip holding no
 * worksheet -- a `.docx` renamed, say. Each is "we could not read this", which the caller
 * records as a reason; none of them is an empty spreadsheet, and this must not return `""`
 * for them (`CLAUDE.md` rule 2).
 */
export function readXlsx(bytes: Uint8Array): string | null {
  const index = readZipIndex(bytes);
  const sheets = worksheetNames(index);
  if (sheets.length === 0) {
    return null;
  }

  const shared = sharedStrings(readZipText(bytes, index, SHARED_STRINGS));
  const texts: string[] = [];
  for (const sheet of sheets) {
    const xml = readZipText(bytes, index, sheet);
    if (xml === null) {
      return null; // A worksheet we could not inflate. A short workbook reads as a complete one.
    }
    texts.push(sheetText(xml, shared));
  }

  return texts.join(SHEET_SEPARATOR);
}
