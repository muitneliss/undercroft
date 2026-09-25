/**
 * What a legacy Word document says, as text.
 *
 * The [MS-DOC] half of the `.doc` reader; `cfb.ts` is the container half and `docTables.ts`
 * tells a table row from a cell. Together they are what ADR 0028 and ADR 0036 declined to buy
 * from LibreOffice, and they could be written instead because TEXT is the one simple part of a
 * `.doc`. A Word 97 file keeps every character it holds in one table -- the piece table, in
 * the `Clx` -- that says where each run of characters sits in the `WordDocument` stream and
 * whether it is stored one byte a character or two. Formatting, styles and drawings live
 * elsewhere, and none of them is needed to know what the document says. ADR 0053.
 *
 * IT READS EVERY PIECE, WHICH IS `docx.ts`'s LEXICAL RULE IN THIS FORMAT'S TERMS. The piece
 * table covers the body AND every subdocument after it -- footnotes, headers and footers,
 * comments, endnotes, text boxes -- in one character space. Reading all of it, rather than the
 * body's `ccpText` characters, is what makes a fee in a text box or a clause in a footer
 * arrive without this module knowing that either exists. The sibling project's two recorded
 * bugs (`docx.ts` has them) were a structural walk visiting only the shapes it knew; a walk
 * over pieces has no shapes to know.
 *
 * WHAT IT REFUSES, by name, through the caller:
 *
 *   - `word95`: a file from before Word 97. Its FIB has another layout, and its 8-bit text is
 *     in whatever codepage the machine that wrote it used. Decoding a Vietnamese Word 95 file
 *     as Windows-1252 would not fail -- it would return confident Latin letters that were
 *     never in the document, which is `CLAUDE.md` rule 2 broken quietly. This is what
 *     `legacy-doc-unsupported` now means, and all it now means.
 *   - `encrypted`: the password bit is set. The text is ciphertext; the bytes are intact.
 *   - `unreadable`: anything else this reader cannot read exactly. A half-read document looks
 *     downstream exactly like a short one, so there is no partial result.
 *
 * WINDOWS-1252 FOR A ONE-BYTE PIECE IS THE SPEC, NOT A GUESS. [MS-DOC] 2.4.1 fixes a
 * compressed piece's encoding as 8-bit ANSI under the Windows-1252 mapping whatever language
 * the document is in, and Word 97 and later store anything outside it as a two-byte piece.
 * That is why a Word 97 file decodes exactly and a Word 95 one cannot.
 */

import { openCfb } from "./cfb.ts";
import { type ParagraphEnd, type ParagraphEnds, readParagraphEnds } from "./docTables.ts";

export type DocRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly why: "word95" | "encrypted" | "unreadable" };

const UNREADABLE: DocRead = { ok: false, why: "unreadable" };

const WORD_IDENT = 0xa5_ec;
/**
 * Word 97 writes 0xC1; later versions write more. 0xC0 is the empty template Windows' "New >
 * Word Document" copies and 0xC2 the BiDi build of Word 97 ([MS-DOC] 2.5.2, note 13) -- both
 * the Word 97 layout, which is why the boundary is 0xC0. Word 6 and 95 write 0x65 to 0x69.
 */
const FIRST_WORD97_NFIB = 0xc0;

const F_ENCRYPTED = 0x01_00;
const F_WHICH_TABLE_STREAM = 0x02_00;

/** Positions in `FibRgFcLcb97`, which lists (offset, length) pairs into the table stream. */
const FC_PLCF_BTE_PAPX = 13;
const FC_CLX = 33;

const CLX_PRC = 0x01;
const CLX_PCDT = 0x02;
const PCD_BYTES = 8;
const COMPRESSED = 0x40_00_00_00;
const FC_MASK = 0x3f_ff_ff_ff;

const PARAGRAPH = 0x0d;
const CELL_OR_ROW = 0x07;

/** Cells across, lines down: the shape `docx.ts` and `xlsx.ts` already write. */
const CELL_SEPARATOR = " | ";
const LINE_END = /[\s|]+$/u;

/**
 * What Word's other marker characters become; any control character not listed is Word's own
 * bookkeeping -- a picture anchor, a note reference -- and is dropped.
 *
 * Line, page and column breaks end a line. A field is `begin instruction separator result
 * end`: the begin and end marks go, the separator becomes a space, so `HYPERLINK "x"` and the
 * link's text cannot arrive glued into one token nobody wrote. The instruction is kept, as
 * `docx.ts` keeps `w:instrText` -- noise in a search index is the direction to err in.
 */
const SPECIAL: ReadonlyMap<number, string> = new Map([
  [0x09, "\t"],
  [0x0b, "\n"],
  [0x0c, "\n"],
  [0x0e, "\n"],
  [0x14, " "],
  [0x1e, "-"],
]);
const FIRST_PRINTABLE = 0x20;

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

interface Fib {
  readonly nFib: number;
  readonly flags: number;
  /** A table-stream slice named by its `FibRgFcLcb97` index, or `null` if it is not there. */
  readonly slice: (table: Uint8Array, index: number) => Uint8Array | null;
}

/**
 * The File Information Block at the head of `WordDocument`: a fixed base, then three counted
 * arrays, the last of which holds the (offset, length) pairs everything else is found by.
 */
function readFib(word: Uint8Array): Fib | null {
  const view = viewOf(word);
  if (word.byteLength < 34 || view.getUint16(0, true) !== WORD_IDENT) {
    return null;
  }
  const cslwAt = 34 + view.getUint16(32, true) * 2;
  const countAt =
    cslwAt + 2 + (cslwAt + 2 <= word.byteLength ? view.getUint16(cslwAt, true) : 0) * 4;
  if (countAt + 2 > word.byteLength) {
    return null;
  }
  const pairs = view.getUint16(countAt, true);
  return {
    nFib: view.getUint16(2, true),
    flags: view.getUint16(0x0a, true),
    slice: (table: Uint8Array, index: number): Uint8Array | null => {
      const at = countAt + 2 + index * 8;
      if (index >= pairs || at + 8 > word.byteLength) {
        return null;
      }
      const fc = view.getUint32(at, true);
      const lcb = view.getUint32(at + 4, true);
      return fc + lcb <= table.byteLength ? table.subarray(fc, fc + lcb) : null;
    },
  };
}

interface Piece {
  /** Where the piece's first character sits in the `WordDocument` stream. */
  readonly start: number;
  readonly count: number;
  readonly compressed: boolean;
}

/** Where the piece table starts in a `Clx`, past the formatting records (`Prc`) before it. */
function pcdtAt(clx: Uint8Array): number | null {
  let at = 0;
  while (clx[at] === CLX_PRC && at + 3 <= clx.byteLength) {
    // Signed on the wire; a negative length would walk backwards forever.
    const length = viewOf(clx).getInt16(at + 1, true);
    if (length < 0) {
      return null;
    }
    at += 3 + length;
  }
  return clx[at] === CLX_PCDT && at + 5 <= clx.byteLength ? at : null;
}

/** The piece table: n+1 character positions, then n eight-byte piece descriptors. */
function readPieces(clx: Uint8Array, wordBytes: number): Piece[] | null {
  const at = pcdtAt(clx);
  if (at === null) {
    return null;
  }
  const view = viewOf(clx);
  const lcb = view.getUint32(at + 1, true);
  const plc = at + 5;
  const count = (lcb - 4) / (4 + PCD_BYTES);
  if (plc + lcb > clx.byteLength || !Number.isInteger(count) || count < 1) {
    return null;
  }
  const pieces: Piece[] = [];
  for (let index = 0; index < count; index += 1) {
    const characters =
      view.getUint32(plc + index * 4 + 4, true) - view.getUint32(plc + index * 4, true);
    const fc = view.getUint32(plc + (count + 1) * 4 + index * PCD_BYTES + 2, true);
    const compressed = (fc & COMPRESSED) !== 0;
    // A compressed piece's offset is stored doubled. [MS-DOC] 2.9.73.
    const start = compressed ? (fc & FC_MASK) / 2 : fc & FC_MASK;
    const end = start + characters * (compressed ? 1 : 2);
    if (characters < 0 || !Number.isInteger(start) || end > wordBytes) {
      return null;
    }
    pieces.push({ start, count: characters, compressed });
  }
  return pieces;
}

const ansi = new TextDecoder("windows-1252");
const unicode = new TextDecoder("utf-16le");

/** What one of Word's two paragraph-ending characters becomes, given the property on it. */
function markText(code: number, end: ParagraphEnd): typeof CELL_SEPARATOR | "\n" {
  const endsCell = code === CELL_OR_ROW ? end !== "row" : end === "cell";
  return endsCell ? CELL_SEPARATOR : "\n";
}

/**
 * One piece's characters, with Word's markers turned into the line structure they stand for.
 *
 * Both decoders yield exactly one UTF-16 unit per stored character, so the `j`th unit is the
 * `j`th character and its stream offset is computed rather than searched for.
 */
function pieceText(word: Uint8Array, piece: Piece, ends: ParagraphEnds): string {
  const width = piece.compressed ? 1 : 2;
  const decoded = (piece.compressed ? ansi : unicode).decode(
    word.subarray(piece.start, piece.start + piece.count * width),
  );
  let out = "";
  for (let index = 0; index < decoded.length; index += 1) {
    const code = decoded.charCodeAt(index);
    if (code === PARAGRAPH || code === CELL_OR_ROW) {
      out += markText(code, ends(piece.start + index * width));
    } else {
      out += code < FIRST_PRINTABLE ? (SPECIAL.get(code) ?? "") : decoded.charAt(index);
    }
  }
  return out;
}

/**
 * Read a `.doc` into text, or say why not.
 *
 * Empty lines are dropped and a row's trailing separators trimmed, which is `docx.ts`'s rule:
 * a document is mostly empty paragraphs, and `... | | |` off every row teaches a reader to
 * skip the ends of lines, which is where a table's last column is.
 */
export function readDoc(bytes: Uint8Array): DocRead {
  const cfb = openCfb(bytes);
  const word = cfb?.stream("WordDocument") ?? null;
  const fib = word === null ? null : readFib(word);
  if (cfb === null || word === null || fib === null) {
    return UNREADABLE;
  }
  if (fib.nFib < FIRST_WORD97_NFIB) {
    return { ok: false, why: "word95" };
  }
  if ((fib.flags & F_ENCRYPTED) !== 0) {
    return { ok: false, why: "encrypted" };
  }

  const table = cfb.stream((fib.flags & F_WHICH_TABLE_STREAM) === 0 ? "0Table" : "1Table");
  const clx = table === null ? null : fib.slice(table, FC_CLX);
  const plcBte = table === null ? null : fib.slice(table, FC_PLCF_BTE_PAPX);
  const pieces = clx === null ? null : readPieces(clx, word.byteLength);
  const ends = plcBte === null ? null : readParagraphEnds(word, plcBte);
  if (pieces === null || ends === null) {
    return UNREADABLE;
  }

  const text = pieces
    .map((piece) => pieceText(word, piece, ends))
    .join("")
    .split("\n")
    .map((line) => line.replace(LINE_END, ""))
    .filter((line) => line !== "")
    .join("\n");
  return { ok: true, text };
}
