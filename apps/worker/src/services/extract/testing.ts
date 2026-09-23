/**
 * Real containers, written the way a writer writes them.
 *
 * The fixtures the readers stand on. Each is a real implementation of the format rather than a
 * stand-in for it (`tests.md`): `zipOf` writes genuine local headers, a genuine central
 * directory, an end record and real CRCs; `pdfOf` writes genuine objects, a genuine cross
 * reference table and a trailer that poppler follows. A hand-made object that skipped the
 * container would make a broken parser look fine.
 *
 * THEY ARE FORMAT-AGNOSTIC ABOUT THEIR CONTENTS, which is why they live here rather than
 * inside one suite. A zip member is a name and a body: pass `xl/worksheets/sheet1.xml` and it
 * is a workbook, pass `word/document.xml` and it is a document. `zipOf` was private to
 * `xlsx.test.ts` until the `.docx` reader needed it too, and sixty lines of zip-format detail
 * in two copies is sixty lines that drift -- one suite learns about data descriptors and the
 * other does not.
 *
 * NO COMMITTED BINARY FIXTURE, therefore, and nothing to regenerate when a reader changes.
 * That rule is what brings `pdfOf` here rather than a checked-in `.pdf`: `accuracy.ts` scores
 * the shipped readers against documents whose exact text we authored, and a gold document
 * whose bytes nobody in the repo can read or edit is a gold document nobody can check.
 *
 * NOT ONLY FOR SUITES. `goldSet.ts` is not a test file and imports both, deliberately -- the
 * accuracy measurement authors documents for the same reason a suite does, and a second
 * container writer beside this one would be the drift this module exists to prevent.
 */

import { crc32, deflateRawSync } from "node:zlib";

const LOCAL_SIGNATURE = 0x04_03_4b_50;
const CENTRAL_SIGNATURE = 0x02_01_4b_50;
const EOCD_SIGNATURE = 0x06_05_4b_50;
const LOCAL_BYTES = 30;
const CENTRAL_BYTES = 46;
const EOCD_BYTES = 22;
const DEFLATED = 8;
const STORED = 0;

const utf8 = new TextEncoder();

export interface ZipMember {
  readonly name: string;
  readonly body: string;
  /** Written uncompressed. Deflated when absent, which is what Word and Excel themselves emit. */
  readonly stored?: boolean;
  /**
   * Bytes that are NOT the deflate stream the directory claims, so the member cannot be
   * inflated -- a truncated upload, an archive a sync half-wrote. The reader's fail-whole rule
   * is about exactly this member, and a rule with no way to fire is not a rule.
   */
  readonly corrupt?: boolean;
}

/** One member as it goes on the wire: the two headers must agree about all four of these. */
interface Written {
  readonly name: Uint8Array;
  readonly method: number;
  readonly plain: Uint8Array;
  readonly data: Uint8Array;
}

function written(member: ZipMember): Written {
  const name = utf8.encode(member.name);
  const plain = utf8.encode(member.body);
  if (member.corrupt === true) {
    return { name, method: DEFLATED, plain, data: utf8.encode("not a deflate stream") };
  }
  const method = member.stored === true ? STORED : DEFLATED;
  return { name, method, plain, data: method === STORED ? plain : deflateRawSync(plain) };
}

function localHeader({ name, method, plain, data }: Written): Uint8Array {
  const local = new Uint8Array(LOCAL_BYTES + name.length + data.length);
  const view = new DataView(local.buffer);
  view.setUint32(0, LOCAL_SIGNATURE, true);
  view.setUint16(4, 20, true);
  view.setUint16(8, method, true);
  view.setUint32(14, crc32(plain), true);
  view.setUint32(18, data.length, true);
  view.setUint32(22, plain.length, true);
  view.setUint16(26, name.length, true);
  local.set(name, LOCAL_BYTES);
  local.set(data, LOCAL_BYTES + name.length);
  return local;
}

function centralEntry({ name, method, plain, data }: Written, offset: number): Uint8Array {
  const entry = new Uint8Array(CENTRAL_BYTES + name.length);
  const view = new DataView(entry.buffer);
  view.setUint32(0, CENTRAL_SIGNATURE, true);
  view.setUint16(10, method, true);
  view.setUint32(16, crc32(plain), true);
  view.setUint32(20, data.length, true);
  view.setUint32(24, plain.length, true);
  view.setUint16(28, name.length, true);
  view.setUint32(42, offset, true);
  entry.set(name, CENTRAL_BYTES);
  return entry;
}

function endRecord(count: number, directoryBytes: number, offset: number): Uint8Array {
  const end = new Uint8Array(EOCD_BYTES);
  const view = new DataView(end.buffer);
  view.setUint32(0, EOCD_SIGNATURE, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, directoryBytes, true);
  view.setUint32(16, offset, true);
  return end;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

/**
 * A PDF holding these pages, one line per string, in Helvetica at 14pt on A4.
 *
 * WHAT IT IS FOR. `pdftotext` and `pdftoppm` are native programs and the only honest way to
 * measure what they read is to hand them a file they accept. This writes one: a catalogue, a
 * page tree, a base-14 font, one uncompressed content stream per page, a cross reference table
 * and a trailer. Poppler reads it, renders it and OCRs it -- verified against all three
 * binaries, not assumed.
 *
 * THE WHOLE FILE IS ASCII BY CONSTRUCTION, which is what lets the cross reference table be
 * built from string offsets. Every code point above 127 leaves as a three-digit octal escape
 * bound to a slot in the font's `/Differences` table, so a caller may pass Vietnamese and the
 * byte offsets stay exact. Both halves of that are load-bearing: an offset computed in UTF-16
 * units over a file written as UTF-8 points into the middle of an object, and poppler then
 * reports a damaged file rather than the text.
 *
 * WHAT A RENDERED PAGE WILL NOT SHOW is anything outside the substituted font's repertoire.
 * Measured: `pdftotext` reads `Hợp đồng` from this writer's output exactly, and the same file
 * rasterised through `pdftoppm` loses the accented glyphs entirely, because poppler's stand-in
 * for Helvetica has none. That asymmetry is a fact about fonts, not about OCR, and it is why
 * `goldSet.ts` scores OCR on ASCII only and says so rather than reporting a Vietnamese number
 * that would be measuring this fixture.
 */
export function pdfOf(
  pages: readonly (readonly string[])[],
  { pointSize = DEFAULT_POINT_SIZE }: PdfOptions = {},
): Uint8Array {
  const slots = new Map<string, number>();
  const bodies = pages.map((lines) => pageStream(lines, slots, pointSize));

  // Fixed identifiers rather than a running counter: the page objects have to name their
  // parent, and a parent numbered by where it happens to land is how a `/Parent` ends up
  // pointing at a font. Poppler renders such a file anyway, which is exactly why the mistake
  // survives until something else follows the reference.
  const objects = [
    `<< /Type /Catalog /Pages ${obj(PAGES_ID)} >>`,
    `<< /Type /Pages /Count ${String(pages.length)} /Kids [${pages
      .map((_page, at) => obj(FIRST_PAGE_ID + at * 2))
      .join(" ")}] >>`,
    fontObject(slots),
    ...bodies.flatMap((body, at) => [
      `<< /Type /Page /Parent ${obj(PAGES_ID)} /MediaBox [0 0 ${String(PAGE_WIDTH)} ${String(PAGE_HEIGHT)}] /Resources << /Font << /F1 ${obj(FONT_ID)} >> >> /Contents ${obj(FIRST_PAGE_ID + at * 2 + 1)} >>`,
      `<< /Length ${String(body.length)} >>\nstream\n${body}\nendstream`,
    ]),
  ];

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [at, body] of objects.entries()) {
    offsets.push(out.length);
    out += `${String(at + 1)} 0 obj\n${body}\nendobj\n`;
  }

  const startXref = out.length;
  const size = objects.length + 1;
  out += `xref\n0 ${String(size)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(XREF_DIGITS, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${String(size)} /Root ${obj(CATALOG_ID)} >>\nstartxref\n${String(startXref)}\n%%EOF\n`;

  return utf8.encode(out);
}

const CATALOG_ID = 1;
const PAGES_ID = 2;
const FONT_ID = 3;
const FIRST_PAGE_ID = 4;
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const XREF_DIGITS = 10;
/** The first `/Differences` slot. Below it WinAnsi already answers, and identically. */
const FIRST_SLOT = 128;
const LAST_SLOT = 255;

/**
 * Generous, so a page renders legibly by default -- and adjustable, because the size is the
 * variable OCR is most sensitive to and a real invoice is not set in 14pt.
 */
const DEFAULT_POINT_SIZE = 14;
/** The gap a line advance leaves. Four points of it, which is ordinary single spacing. */
const EXTRA_LEADING = 4;

export interface PdfOptions {
  readonly pointSize?: number;
}

function obj(id: number): string {
  return `${String(id)} 0 R`;
}

/**
 * One page's content stream: the text, laid out top-down from the margin.
 *
 * `slots` is shared across every page so one font object serves the whole document, and it is
 * MUTATED here rather than collected in two passes -- the alternative is walking the text once
 * to assign slots and once to escape it, which is two places that must agree about what counts
 * as a character.
 */
function pageStream(
  lines: readonly string[],
  slots: Map<string, number>,
  pointSize: number,
): string {
  const drawn = lines.map((line) => `(${escapeText(line, slots)}) Tj T*`);
  return [
    "BT",
    `/F1 ${String(pointSize)} Tf`,
    "1 0 0 1 72 720 Tm",
    `${String(pointSize + EXTRA_LEADING)} TL`,
    ...drawn,
    "ET",
  ].join("\n");
}

/** A PDF literal string: the three characters that end one, and everything non-ASCII. */
function escapeText(line: string, slots: Map<string, number>): string {
  let out = "";
  for (const character of line) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\\" || character === "(" || character === ")") {
      out += `\\${character}`;
    } else if (code < FIRST_SLOT) {
      out += character;
    } else {
      out += `\\${slotFor(character, slots).toString(8).padStart(3, "0")}`;
    }
  }
  return out;
}

function slotFor(character: string, slots: Map<string, number>): number {
  const known = slots.get(character);
  if (known !== undefined) {
    return known;
  }
  const slot = FIRST_SLOT + slots.size;
  if (slot > LAST_SLOT) {
    // A fixture, so this raises rather than dropping the character: a gold document quietly
    // missing its 129th distinct accented letter would score the reader for the writer's bug.
    throw new Error("pdfOf: more than 128 distinct non-ASCII characters in one document");
  }
  slots.set(character, slot);
  return slot;
}

/**
 * Helvetica, with every non-ASCII character the document uses named by its code point.
 *
 * `/uniXXXX` is the Adobe glyph-name form, which is what makes `pdftotext` answer with the
 * character we meant rather than with whatever byte the slot happens to be.
 */
function fontObject(slots: ReadonlyMap<string, number>): string {
  const differences = [...slots]
    .sort((a, b) => a[1] - b[1])
    .map(
      ([character, slot]) =>
        `${String(slot)} /uni${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`,
    )
    .join(" ");
  const encoding =
    differences === ""
      ? "/WinAnsiEncoding"
      : `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [${differences}] >>`;
  return `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding ${encoding} >>`;
}

/** An archive holding these members, in this order. */
export function zipOf(members: readonly ZipMember[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;

  for (const member of members) {
    const wire = written(member);
    const local = localHeader(wire);
    parts.push(local);
    directory.push(centralEntry(wire, offset));
    offset += local.length;
  }

  const directoryBytes = directory.reduce((total, entry) => total + entry.length, 0);
  return concat([...parts, ...directory, endRecord(members.length, directoryBytes, offset)]);
}
