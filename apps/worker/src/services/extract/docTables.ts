/**
 * Which paragraph marks in a `.doc` end a table row, and which end a nested cell.
 *
 * `doc.ts` reads the text and needs this for one decision only. In [MS-DOC] a cell ends with
 * character 7 and so does a row, and nothing in the text tells them apart -- a row holding an
 * empty cell and a row end are the same two characters. A nested table goes the other way: its
 * cells and rows end with an ordinary paragraph mark. What does tell them apart is a
 * paragraph property on the mark: `sprmPFTtp` for a row end, `sprmPFInnerTtp` and
 * `sprmPFInnerTableCell` for their nested counterparts. Without them every table reads as one
 * long line -- the table semantics `docx.ts` records a sibling project losing irrecoverably.
 *
 * WHAT IS READ IS A SEPARATOR, NEVER A CHARACTER. The property picks between a newline and a
 * ` | `; the text around it is the same either way. That is why this module can stay narrow:
 * it walks each property list only far enough to find three flags, and knows nothing about
 * what the other properties mean.
 *
 * IT STILL REFUSES A LIST IT CANNOT WALK. A property whose length runs past its page would put
 * the next one's bytes where a flag is expected, and a corrupt page is a corrupt file; `null`
 * goes up and `doc.ts` refuses the document rather than laying out a table it half-read.
 */

/** How a paragraph mark reads. `paragraph` is everything that is not a table boundary. */
export type ParagraphEnd = "paragraph" | "cell" | "row";

/** Where a paragraph mark at this byte offset of `WordDocument` belongs. */
export type ParagraphEnds = (offset: number) => ParagraphEnd;

/**
 * Formatted disk pages: 512 bytes each, holding runs of stream offsets and a property list for
 * each run. [MS-DOC] 2.9.176.
 */
const FKP_BYTES = 512;
const BX_PAP_BYTES = 13;
const PN_MASK = 0x3f_ff_ff;

const SPRM_P_F_TTP = 0x24_17;
const SPRM_P_F_INNER_TTP = 0x24_4c;
const SPRM_P_F_INNER_TABLE_CELL = 0x24_4b;

/** The two variable-length properties that do not follow the one-byte length rule. */
const SPRM_T_DEF_TABLE = 0xd6_08;
const SPRM_P_CHG_TABS = 0xc6_15;
const CHG_TABS_LONG_FORM = 0xff;

/** An operand's size by `spra`, the top three bits of the property id. 6 is variable. */
const FIXED_OPERAND: readonly (number | null)[] = [1, 1, 2, 4, 2, 2, null, 3];

interface Span {
  readonly from: number;
  readonly to: number;
  readonly end: ParagraphEnd;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** How many bytes a property's operand takes, starting at `at`. */
function operandBytes(grpprl: Uint8Array, sprm: number, at: number): number {
  const fixed = FIXED_OPERAND[sprm >>> 13];
  if (fixed !== null && fixed !== undefined) {
    return fixed;
  }
  if (sprm === SPRM_T_DEF_TABLE) {
    // A 16-bit count of the bytes after it, plus one. [MS-DOC] 2.9.340.
    return at + 2 <= grpprl.byteLength
      ? 2 + viewOf(grpprl).getUint16(at, true) - 1
      : Number.POSITIVE_INFINITY;
  }
  const length = grpprl[at] ?? 0;
  if (sprm === SPRM_P_CHG_TABS && length === CHG_TABS_LONG_FORM) {
    // Two counted arrays instead of a length: deletions at 4 bytes each, additions at 3.
    const deleted = grpprl[at + 1] ?? 0;
    const added = grpprl[at + 2 + deleted * 4] ?? 0;
    return 3 + deleted * 4 + added * 3;
  }
  return 1 + length;
}

/** What this property list says about the mark it belongs to, or `null` if it cannot be walked. */
function endOf(grpprl: Uint8Array): ParagraphEnd | null {
  const view = viewOf(grpprl);
  let end: ParagraphEnd = "paragraph";
  let at = 0;
  while (at + 2 <= grpprl.byteLength) {
    const sprm = view.getUint16(at, true);
    const size = operandBytes(grpprl, sprm, at + 2);
    if (at + 2 + size > grpprl.byteLength) {
      return null;
    }
    const on = grpprl[at + 2] === 1;
    if (on && (sprm === SPRM_P_F_TTP || sprm === SPRM_P_F_INNER_TTP)) {
      end = "row";
    } else if (on && sprm === SPRM_P_F_INNER_TABLE_CELL && end === "paragraph") {
      end = "cell";
    }
    at += 2 + size;
  }
  return end;
}

/**
 * One run's property list, located by its `BxPap`: a count of 16-bit words, or a zero and then
 * a count of bytes over two ([MS-DOC] 2.9.175). The first two bytes are the style, which is
 * skipped -- a row end is always direct formatting.
 */
function runEnd(fkp: Uint8Array, bxAt: number): ParagraphEnd | null {
  const offset = (fkp[bxAt] ?? 0) * 2;
  if (offset === 0) {
    return "paragraph";
  }
  const first = fkp[offset] ?? 0;
  const [bodyAt, bodyBytes] =
    first === 0 ? [offset + 2, (fkp[offset + 1] ?? 0) * 2] : [offset + 1, first * 2 - 1];
  return bodyBytes < 2 || bodyAt + bodyBytes > FKP_BYTES
    ? null
    : endOf(fkp.subarray(bodyAt + 2, bodyAt + bodyBytes));
}

/** The table boundaries one page describes, or `null` if the page is not one. */
function pageSpans(fkp: Uint8Array): Span[] | null {
  const runs = fkp[FKP_BYTES - 1] ?? 0;
  const bxStart = (runs + 1) * 4;
  if (bxStart + runs * BX_PAP_BYTES > FKP_BYTES - 1) {
    return null;
  }
  const view = viewOf(fkp);
  const spans: Span[] = [];
  for (let run = 0; run < runs; run += 1) {
    const end = runEnd(fkp, bxStart + run * BX_PAP_BYTES);
    if (end === null) {
      return null;
    }
    if (end !== "paragraph") {
      spans.push({
        from: view.getUint32(run * 4, true),
        to: view.getUint32(run * 4 + 4, true),
        end,
      });
    }
  }
  return spans;
}

function lookup(spans: readonly Span[]): ParagraphEnds {
  return (offset: number): ParagraphEnd => {
    let low = 0;
    let high = spans.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const span = spans[middle];
      if (span === undefined || offset < span.from) {
        high = middle - 1;
      } else if (offset >= span.to) {
        low = middle + 1;
      } else {
        return span.end;
      }
    }
    return "paragraph";
  };
}

/**
 * Read `PlcBtePapx` -- the list of pages -- and every page it names out of `WordDocument`.
 *
 * Only the table boundaries are kept; every other paragraph needs no entry, and a document
 * with no tables answers `paragraph` for everything. An empty list is such a document, not a
 * corrupt one.
 */
export function readParagraphEnds(word: Uint8Array, plcBte: Uint8Array): ParagraphEnds | null {
  if (plcBte.byteLength === 0) {
    return lookup([]);
  }
  const pages = (plcBte.byteLength - 4) / 8;
  if (!Number.isInteger(pages) || pages < 1) {
    return null;
  }
  const view = viewOf(plcBte);
  const spans: Span[] = [];
  for (let index = 0; index < pages; index += 1) {
    const at = (view.getUint32((pages + 1 + index) * 4, true) & PN_MASK) * FKP_BYTES;
    const page =
      at + FKP_BYTES <= word.byteLength ? pageSpans(word.subarray(at, at + FKP_BYTES)) : null;
    if (page === null) {
      return null;
    }
    spans.push(...page);
  }
  return lookup(spans.sort((a, b) => a.from - b.from));
}
