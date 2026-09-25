/**
 * A real Word 97 `.doc`, written the way a writer writes one.
 *
 * `testing.ts`'s rule, for the legacy Word reader: a fixture is the format, not a byte string
 * shaped like it, or a broken parser looks fine. So `docOf` writes all of it -- a version 3
 * compound file with its FAT, mini stream and directory tree, and inside it a FIB, a piece
 * table and a page of paragraph properties. LibreOffice opens what this writes, tables
 * included, which is the evidence that it is the format and not a shape only our reader takes.
 * It lives here rather than in `testing.ts` for length alone; `cfbTesting.ts` writes the
 * container.
 *
 * WHAT IT DELIBERATELY EXERCISES, because each is a way to read the format wrong:
 *
 *   - each paragraph is its own piece, as after any edit in Word, one byte or two a character;
 *   - a formatting record precedes the piece table in the `Clx`, which a reader must skip;
 *   - a row end's `sprmTDefTable` comes BEFORE its `sprmPFTtp`, so a reader that sizes that
 *     property wrongly misses the flag;
 *   - streams under 4 KiB go in the mini stream and larger ones in the file's own sectors;
 *   - text boxes sit after the body, outside `ccpText`;
 *   - an embedded document's `WordDocument` is written to the directory before the outer one.
 */

import { cfbOf } from "./cfbTesting.ts";

/** One paragraph of a `.doc`, and what ends it. */
export interface DocParagraph {
  readonly text: string;
  /** A paragraph mark unless it closes a table cell or a table row. */
  readonly ends?: "paragraph" | "cell" | "row";
  /** Stored one byte a character in Windows-1252, as Word stores a run of text that fits. */
  readonly compressed?: boolean;
}

export interface DocOptions {
  /** The FIB's version. Word 97 writes 0xC1; Word 95 wrote 0x68. */
  readonly nFib?: number;
  /** Sets the FIB's password bit. The text is left in the clear, so only the bit is tested. */
  readonly encrypted?: boolean;
  /** Another document's paragraphs, embedded under `ObjectPool` the way Word embeds one. */
  readonly embedded?: readonly DocParagraph[];
  /** Text-box paragraphs, stored after the body and counted in `ccpTxbx`, not `ccpText`. */
  readonly textBoxes?: readonly DocParagraph[];
}

const TEXT_AT = 1024;
const FKP = 512;
const BX_PAP_BYTES = 13;
const FIB_PAIRS = 93;
/** One formatting record: a one-byte property list the piece table's reader must skip. */
const PRC = [0x01, 0x01, 0x00, 0x29];
const PLC_AT = PRC.length + 5;
const COMPRESSED = 0x40_00_00_00;

const IN_TABLE = [0x16, 0x24, 1];
const TTP = [0x17, 0x24, 1];
const COLUMN_TWIPS = 2000;
const TC80_BYTES = 20;

const windows1252 = new Map(
  Array.from({ length: 256 }, (_unused, byte) => [
    new TextDecoder("windows-1252").decode(Uint8Array.of(byte)),
    byte,
  ]),
);

function encodeCharacters(text: string, compressed: boolean): Uint8Array {
  if (!compressed) {
    const out = new Uint8Array(text.length * 2);
    const view = new DataView(out.buffer);
    for (let at = 0; at < text.length; at += 1) {
      view.setUint16(at * 2, text.charCodeAt(at), true);
    }
    return out;
  }
  return Uint8Array.from(text, (character) => {
    const byte = windows1252.get(character);
    if (byte === undefined) {
      // A fixture, so this raises: Word would have written this piece two bytes a character.
      throw new Error(`docOf: ${character} is not in Windows-1252; leave it uncompressed`);
    }
    return byte;
  });
}

function stored(paragraph: DocParagraph): Uint8Array {
  const mark = (paragraph.ends ?? "paragraph") === "paragraph" ? "\r" : "\u0007";
  return encodeCharacters(`${paragraph.text}${mark}`, paragraph.compressed === true);
}

/** A paragraph property list: the style, then each property id and its operand. */
function papx(properties: readonly number[]): number[] {
  const body = [0, 0, ...properties];
  // An odd body takes the count-of-words form, an even one the zero-then-count form.
  return body.length % 2 === 1 ? [(body.length + 1) / 2, ...body] : [0, body.length / 2, ...body];
}

/** A row end: its definition -- the column count, edges in twips, a blank cell each -- then flags. */
function rowEnd(cells: number): number[] {
  const edges = Array.from({ length: cells + 1 }, (_unused, at) => [
    (at * COLUMN_TWIPS) % 256,
    Math.floor((at * COLUMN_TWIPS) / 256),
  ]).flat();
  const remainder = [cells, ...edges, ...new Array<number>(cells * TC80_BYTES).fill(0)];
  const counted = remainder.length + 1;
  return [0x08, 0xd6, counted % 256, Math.floor(counted / 256), ...remainder, ...IN_TABLE, ...TTP];
}

/** The property list each paragraph needs, or `null` for an ordinary one. */
function propertyLists(paragraphs: readonly DocParagraph[]): (number[] | null)[] {
  let cells = 0;
  return paragraphs.map((paragraph) => {
    const ends = paragraph.ends ?? "paragraph";
    const list = ends === "row" ? papx(rowEnd(cells)) : ends === "cell" ? papx(IN_TABLE) : null;
    cells = ends === "cell" ? cells + 1 : 0;
    return list;
  });
}

/** The one page of paragraph properties: a run per paragraph, each over its own bytes. */
function fkpOf(bounds: readonly number[], paragraphs: readonly DocParagraph[]): Uint8Array {
  const page = new Uint8Array(FKP);
  const view = new DataView(page.buffer);
  const runs = paragraphs.length;
  for (const [at, bound] of bounds.entries()) {
    view.setUint32(at * 4, bound, true);
  }
  let free = FKP - 1;
  for (const [at, list] of propertyLists(paragraphs).entries()) {
    if (list !== null) {
      free -= list.length + ((free - list.length) % 2);
      if (free < (runs + 1) * 4 + runs * BX_PAP_BYTES) {
        throw new Error("docOf: too many table paragraphs for one property page");
      }
      page.set(list, free);
      page[(runs + 1) * 4 + at * BX_PAP_BYTES] = free / 2;
    }
  }
  page[FKP - 1] = runs;
  return page;
}

/** The table stream: the `Clx` (a formatting record, then the piece table), then `PlcBtePapx`. */
function tableStream(
  paragraphs: readonly DocParagraph[],
  bounds: readonly number[],
  fkpAt: number,
): { bytes: Uint8Array; characters: number[] } {
  const pieces = paragraphs.length;
  const plcBytes = (pieces + 1) * 4 + pieces * 8;
  const bytes = new Uint8Array(PLC_AT + plcBytes + 12);
  const view = new DataView(bytes.buffer);
  bytes.set([...PRC, 0x02]);
  view.setUint32(PRC.length + 1, plcBytes, true);
  const characters = [0];
  for (const [at, paragraph] of paragraphs.entries()) {
    const width = paragraph.compressed === true ? 1 : 2;
    const start = bounds[at] ?? 0;
    characters.push((characters.at(-1) ?? 0) + ((bounds[at + 1] ?? 0) - start) / width);
    view.setUint32(
      PLC_AT + (pieces + 1) * 4 + at * 8 + 2,
      width === 1 ? start * 2 + COMPRESSED : start,
      true,
    );
  }
  for (const [at, cp] of characters.entries()) {
    view.setUint32(PLC_AT + at * 4, cp, true);
  }
  const bteAt = PLC_AT + plcBytes;
  view.setUint32(bteAt, TEXT_AT, true);
  view.setUint32(bteAt + 4, bounds.at(-1) ?? 0, true);
  view.setUint32(bteAt + 8, fkpAt / FKP, true);
  return { bytes, characters };
}

/** The FIB: the fixed base, then counted arrays whose last holds the table-stream pairs. */
function writeFib(word: Uint8Array, options: DocOptions, fields: readonly number[]): void {
  const [bteAt = 0, bodyCharacters = 0, allCharacters = 0] = fields;
  const view = new DataView(word.buffer);
  view.setUint16(0, 0xa5_ec, true);
  view.setUint16(2, options.nFib ?? 0xc1, true);
  view.setUint16(0x0a, 0x02_00 + (options.encrypted === true ? 0x01_00 : 0), true);
  view.setUint16(32, 14, true);
  view.setUint16(62, 22, true);
  // `ccpText` and `ccpTxbx` in `FibRgLw97`.
  view.setUint32(64 + 3 * 4, bodyCharacters, true);
  view.setUint32(64 + 9 * 4, allCharacters - bodyCharacters, true);
  view.setUint16(152, FIB_PAIRS, true);
  view.setUint32(154 + 13 * 8, bteAt, true);
  view.setUint32(154 + 13 * 8 + 4, 12, true);
  view.setUint32(154 + 33 * 8 + 4, bteAt, true);
}

/** `WordDocument` and `1Table` for these paragraphs. */
function wordStreams(body: readonly DocParagraph[], options: DocOptions): [Uint8Array, Uint8Array] {
  const paragraphs = [...body, ...(options.textBoxes ?? [])];
  const texts = paragraphs.map(stored);
  const bounds = [TEXT_AT];
  for (const text of texts) {
    bounds.push((bounds.at(-1) ?? 0) + text.length);
  }
  const fkpAt = Math.ceil((bounds.at(-1) ?? 0) / FKP) * FKP;
  const word = new Uint8Array(fkpAt + FKP);
  for (const [at, text] of texts.entries()) {
    word.set(text, bounds[at]);
  }
  word.set(fkpOf(bounds, paragraphs), fkpAt);
  const table = tableStream(paragraphs, bounds, fkpAt);
  writeFib(word, options, [
    table.bytes.length - 12,
    table.characters[body.length] ?? 0,
    table.characters.at(-1) ?? 0,
  ]);
  return [word, table.bytes];
}

const ROOT = 5;

/** A Word 97 `.doc` holding these paragraphs. See the module docstring for what it exercises. */
export function docOf(paragraphs: readonly DocParagraph[], options: DocOptions = {}): Uint8Array {
  const [word, table] = wordStreams(paragraphs, options);
  if (options.embedded === undefined) {
    return cfbOf([
      { name: "Root Entry", type: ROOT, child: 1 },
      { name: "WordDocument", type: 2, bytes: word, right: 2 },
      { name: "1Table", type: 2, bytes: table },
    ]);
  }
  const [inner] = wordStreams(options.embedded, {});
  return cfbOf([
    { name: "Root Entry", type: ROOT, child: 3 },
    { name: "ObjectPool", type: 1, child: 2 },
    { name: "WordDocument", type: 2, bytes: inner },
    { name: "WordDocument", type: 2, bytes: word, right: 4 },
    { name: "1Table", type: 2, bytes: table, right: 1 },
  ]);
}
