/**
 * The record grammar of an Excel 97–2003 `Workbook` stream (BIFF8, [MS-XLS] §2.1.4), and the
 * strings inside it. `biff8.ts` reads the workbook; this only cuts the stream into records and
 * reads a string exactly, wherever a record boundary falls through it.
 *
 * A RECORD PAST 8,224 BYTES CONTINUES IN `CONTINUE` RECORDS, and the shared string table always
 * does. So each record is kept with its continuations as SEGMENTS, and a reader moves across a
 * segment boundary as if it were not there -- except in the middle of a string's characters,
 * where the spec puts one byte of flags at the start of the continuation saying whether the rest
 * is one byte or two per character ([MS-XLS] §2.5.293). Ignoring that byte shifts every string
 * after it by one, which reads plausibly and is wrong.
 *
 * Characters are UTF-16, stored with their high byte dropped when every one is below 256: those
 * are ISO-8859-1 by definition, so no code page is ever guessed (a BIFF5 file, which does need
 * one, is refused before it reaches here).
 */

/** One record: its type, and its data as the record and every `CONTINUE` after it. */
export interface BiffRecord {
  readonly type: number;
  /** Where the record starts in the stream: a sheet is found by this offset. */
  readonly offset: number;
  readonly segments: readonly Uint8Array[];
}

/** The record types the Excel 97–2003 reader reads ([MS-XLS] §2.3). */
export const RECORD = {
  bof: 0x08_09,
  eof: 0x00_0a,
  filePass: 0x00_2f,
  dateMode: 0x00_22,
  format: 0x04_1e,
  xf: 0x00_e0,
  boundSheet: 0x00_85,
  sst: 0x00_fc,
  dimensions: 0x02_00,
  row: 0x02_08,
  labelSst: 0x00_fd,
  label: 0x02_04,
  richLabel: 0x00_d6,
  number: 0x02_03,
  rk: 0x02_7e,
  mulRk: 0x00_bd,
  boolErr: 0x02_05,
  formula: 0x00_06,
  string: 0x02_07,
  mergedCells: 0x00_e5,
} as const;

export const CONTINUE = 0x00_3c;
const HEADER_BYTES = 4;
const HIGH_BYTE = 0x01;
const EXTENDED = 0x04;
const RICH = 0x08;
const RUN_BYTES = 4;
const UTF16 = new TextDecoder("utf-16le");
/** Characters decoded per call, so a long string never spreads past the engine's argument limit. */
const CHUNK = 8192;

/**
 * Compressed characters: each byte IS the code unit, its high byte zero (§2.5.293). Not the
 * WHATWG `latin1` decoder, which is windows-1252 and would turn 0x80–0x9F into `€` and friends.
 */
function compressed(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.byteLength; at += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return text;
}

/** The stream's records in order, each with its continuations; `null` when the stream breaks. */
export function recordsOf(stream: Uint8Array): BiffRecord[] | null {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const records: { type: number; offset: number; segments: Uint8Array[] }[] = [];
  for (let at = 0; at + HEADER_BYTES <= stream.byteLength; ) {
    const type = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    const data = stream.subarray(at + HEADER_BYTES, at + HEADER_BYTES + length);
    if (data.byteLength !== length) {
      return null;
    }
    const last = records.at(-1);
    if (type === CONTINUE && last !== undefined) {
      last.segments.push(data);
    } else {
      records.push({ type, offset: at, segments: [data] });
    }
    at += HEADER_BYTES + length;
  }
  return records;
}

/** A position in a record's segments, read forward. Throws `RangeError` past the end. */
export class Cursor {
  readonly #segments: readonly Uint8Array[];
  #segment = 0;
  #at = 0;

  constructor(record: BiffRecord) {
    this.#segments = record.segments;
  }

  #current(): Uint8Array {
    let segment = this.#segments[this.#segment];
    while (segment !== undefined && this.#at >= segment.byteLength) {
      this.#segment += 1;
      this.#at = 0;
      segment = this.#segments[this.#segment];
    }
    if (segment === undefined) {
      throw new RangeError("past the end of the record");
    }
    return segment;
  }

  byte(): number {
    const segment = this.#current();
    const value = segment[this.#at] ?? 0;
    this.#at += 1;
    return value;
  }

  bytes(count: number): Uint8Array {
    const out = new Uint8Array(count);
    for (let at = 0; at < count; at += 1) {
      out[at] = this.byte();
    }
    return out;
  }

  uint16(): number {
    return this.byte() | (this.byte() << 8);
  }

  uint32(): number {
    return (this.uint16() | (this.uint16() << 16)) >>> 0;
  }

  skip(count: number): void {
    for (let at = 0; at < count; at += 1) {
      this.byte();
    }
  }

  /**
   * `count` characters, one or two bytes each by `highByte`. Whenever the characters run past
   * the end of a record, the next record begins with their flags byte again, which can switch
   * the width -- read, never skipped (§2.5.293).
   */
  characters(count: number, highByte: boolean): string {
    let text = "";
    let wide = highByte;
    let read = 0;
    while (read < count) {
      let segment = this.#segments[this.#segment];
      if (segment === undefined) {
        throw new RangeError("characters run past the end of the record");
      }
      if (this.#at >= segment.byteLength) {
        this.#segment += 1;
        segment = this.#segments[this.#segment];
        if (segment === undefined) {
          throw new RangeError("characters run past the end of the record");
        }
        wide = ((segment[0] ?? 0) & HIGH_BYTE) !== 0;
        this.#at = 1;
        continue;
      }
      const width = wide ? 2 : 1;
      const available = Math.floor((segment.byteLength - this.#at) / width);
      if (available === 0) {
        throw new RangeError("a character split across records");
      }
      const take = Math.min(count - read, available);
      const piece = segment.subarray(this.#at, this.#at + take * width);
      text += wide ? UTF16.decode(piece) : compressed(piece);
      this.#at += take * width;
      read += take;
    }
    return text;
  }

  /** An `XLUnicodeString`: a 16-bit count, a flags byte, the characters. */
  string(): string {
    const count = this.uint16();
    return this.characters(count, (this.byte() & HIGH_BYTE) !== 0);
  }

  /** A `ShortXLUnicodeString`: an 8-bit count, a flags byte, the characters. */
  shortString(): string {
    const count = this.byte();
    return this.characters(count, (this.byte() & HIGH_BYTE) !== 0);
  }

  /**
   * An `XLUnicodeRichExtendedString` (§2.5.293): the shared string table's entry. Its formatting
   * runs and phonetic block are skipped -- the text is the characters.
   */
  richString(): string {
    const count = this.uint16();
    const flags = this.byte();
    const runs = (flags & RICH) === 0 ? 0 : this.uint16();
    const extended = (flags & EXTENDED) === 0 ? 0 : this.uint32();
    const text = this.characters(count, (flags & HIGH_BYTE) !== 0);
    this.skip(runs * RUN_BYTES + extended);
    return text;
  }
}
