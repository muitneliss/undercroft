/**
 * The record grammar of an Excel binary workbook's parts (BIFF12, [MS-XLSB] §2.1.4), read as a
 * part inflates. `xlsb.ts` reads the workbook and `xlsbSheet.ts` its sheets; this only cuts a
 * part into records, and `xlsbFields.ts` reads the fields inside one.
 *
 * A RECORD IS A HEADER AND ITS DATA. The header is the record's type, a variable-length integer
 * of one or two bytes, then its size, the same kind of integer in one to four bytes: each byte
 * holds seven bits of the value, low bits first, and its high bit says another byte follows.
 * The last byte a field may have ends it whatever its high bit says -- the spec has the fourth
 * size byte's ignored, and a type is two bytes at most -- so a header is never read past them.
 *
 * READ AS IT INFLATES, NEVER HELD WHOLE (ADR 0106). A worksheet part grows with its data and can
 * inflate past `zip.ts`'s ceiling on a held member, so the splitter is handed the part in pieces
 * and carries only what a piece left unfinished into the next: a record cut by a piece boundary,
 * header or data, is read whole once the next piece arrives. A record the reader does not read
 * is skipped by its size and never held at all, whatever that size says; one it does read is
 * held only up to `MAX_RECORD_BYTES`, past which its header is not believed.
 *
 * A PART THAT ENDS INSIDE A RECORD IS UNREADABLE, never a shorter part (`CLAUDE.md` rule 2): the
 * records before the break were exact, and the stream says it stopped short.
 */

import type { StreamEnd } from "./zip.ts";

/** One record the caller asked for: its type and its data, the header gone. */
export interface XlsbRecord {
  readonly type: number;
  readonly data: Uint8Array;
}

/** The record types the binary workbook reader reads ([MS-XLSB] §2.3.2, "Record Enumeration"). */
export const BRT = {
  rowHdr: 0,
  cellBlank: 1,
  cellRk: 2,
  cellError: 3,
  cellBool: 4,
  cellReal: 5,
  cellSt: 6,
  cellIsst: 7,
  fmlaString: 8,
  fmlaNum: 9,
  fmlaBool: 10,
  fmlaError: 11,
  sstItem: 19,
  fmt: 44,
  xf: 47,
  cellRString: 62,
  beginBook: 131,
  wsDim: 148,
  wbProp: 153,
  bundleSh: 156,
  mergeCell: 176,
  beginCellXFs: 617,
  endCellXFs: 618,
} as const;

/** The largest number one byte of a variable-length integer holds, and its continuation flag. */
const SEVEN_BITS = 128;
const TYPE_BYTES = 2;
const SIZE_BYTES = 4;

/**
 * The most this reader will hold for one record. The largest it reads is a cell or a shared
 * string: 32,767 UTF-16 characters, 65,534 bytes, with their formatting runs, a phonetic block
 * and a formula -- well under this. A size past it is a header that cannot be one.
 */
export const MAX_RECORD_BYTES = 4 * 1024 * 1024;

/**
 * A variable-length integer of at most `width` bytes at `at`: its value and where it ends, or
 * `null` when the buffer ends before it does.
 */
function varint(
  buffer: Uint8Array,
  at: number,
  width: number,
): { value: number; next: number } | null {
  let value = 0;
  for (let used = 0; used < width; used += 1) {
    const byte = buffer[at + used];
    if (byte === undefined) {
      return null;
    }
    value += (byte % SEVEN_BITS) * SEVEN_BITS ** used;
    if (byte < SEVEN_BITS || used === width - 1) {
      return { value, next: at + used + 1 };
    }
  }
  return null;
}

/** A record's header at `at` -- its type, its size, where its data starts -- or `null` if cut. */
function headerAt(
  buffer: Uint8Array,
  at: number,
): { type: number; size: number; start: number } | null {
  const type = varint(buffer, at, TYPE_BYTES);
  const size = type === null ? null : varint(buffer, type.next, SIZE_BYTES);
  return type === null || size === null
    ? null
    : { type: type.value, size: size.value, start: size.next };
}

/**
 * A part cut into records as its pieces arrive. Each piece is appended to what the last one left
 * unfinished; every whole record in it is handed back, and only the unfinished remainder -- or
 * the count of bytes still to skip -- is carried.
 */
class RecordSplitter {
  readonly #wanted: ReadonlySet<number>;
  #pending: Uint8Array = new Uint8Array(0);
  #skipping = 0;

  constructor(wanted: ReadonlySet<number>) {
    this.#wanted = wanted;
  }

  /** `true` once the part has ended between two records, as a whole part does. */
  get between(): boolean {
    return this.#pending.byteLength === 0 && this.#skipping === 0;
  }

  /** The wanted records this piece completes, or `null` for a size no record it reads has. */
  push(piece: Uint8Array): XlsbRecord[] | null {
    const buffer = this.#joined(piece);
    const records: XlsbRecord[] = [];
    let at = Math.min(this.#skipping, buffer.byteLength);
    this.#skipping -= at;
    for (;;) {
      const header = headerAt(buffer, at);
      if (header === null) {
        break;
      }
      const end = header.start + header.size;
      if (!this.#wanted.has(header.type)) {
        this.#skipping = Math.max(0, end - buffer.byteLength);
        at = Math.min(end, buffer.byteLength);
        continue;
      }
      if (header.size > MAX_RECORD_BYTES) {
        return null;
      }
      if (end > buffer.byteLength) {
        break;
      }
      records.push({ type: header.type, data: buffer.subarray(header.start, end) });
      at = end;
    }
    this.#pending = buffer.slice(at);
    return records;
  }

  #joined(piece: Uint8Array): Uint8Array {
    if (this.#pending.byteLength === 0) {
      return piece;
    }
    const joined = new Uint8Array(this.#pending.byteLength + piece.byteLength);
    joined.set(this.#pending);
    joined.set(piece, this.#pending.byteLength);
    return joined;
  }
}

/**
 * The records of `wanted` types a part holds, in order, as its pieces inflate; how the part
 * ended. A part that ends inside a record, or states a size no record it reads can have, ends
 * `unreadable` after the records before it.
 */
export async function* recordsOf(
  pieces: AsyncGenerator<Uint8Array, StreamEnd>,
  wanted: ReadonlySet<number>,
): AsyncGenerator<XlsbRecord, StreamEnd> {
  const splitter = new RecordSplitter(wanted);
  try {
    let step = await pieces.next();
    while (step.done !== true) {
      const records = splitter.push(step.value);
      if (records === null) {
        return "unreadable";
      }
      yield* records;
      step = await pieces.next();
    }
    return step.value === "complete" && !splitter.between ? "unreadable" : step.value;
  } finally {
    // A reader that stops early returns this generator; the inflater beneath closes with it.
    await pieces.return("complete");
  }
}
