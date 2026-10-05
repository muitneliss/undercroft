/**
 * The fields inside one record of an Excel binary workbook ([MS-XLSB] §2.5): integers, the
 * eight bytes of a double, and the three string shapes the reader meets. `xlsbRecords.ts` cuts a
 * part into records; this reads one record's data forward and refuses to read past its end, so a
 * record shorter than its own layout is found out rather than read into the next one.
 */

/** Bit `n` of a flags field, `n` counted from the least significant, as the spec numbers them. */
export function bit(flags: number, n: number): boolean {
  return Math.floor(flags / 2 ** n) % 2 === 1;
}

const UTF16 = new TextDecoder("utf-16le");
const DOUBLE_BYTES = 8;
const CHARACTER_BYTES = 2;
/** An `XLNullableWideString`'s count when it holds no string at all (§2.5.167). */
const NULL_STRING = 0xff_ff_ff_ff;

/** A position in one record's data, read forward. Throws `RangeError` past its end. */
export class Fields {
  readonly #data: Uint8Array;
  readonly #view: DataView;
  #at = 0;

  constructor(data: Uint8Array) {
    this.#data = data;
    this.#view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  #take(count: number): number {
    const at = this.#at;
    if (at + count > this.#data.byteLength) {
      throw new RangeError("past the end of the record");
    }
    this.#at += count;
    return at;
  }

  uint8(): number {
    return this.#view.getUint8(this.#take(1));
  }

  uint16(): number {
    return this.#view.getUint16(this.#take(2), true);
  }

  uint32(): number {
    return this.#view.getUint32(this.#take(4), true);
  }

  int32(): number {
    return this.#view.getInt32(this.#take(4), true);
  }

  /** The eight bytes of an `Xnum`, a little-endian IEEE-754 double, for `doubleText`. */
  double(): Uint8Array {
    const at = this.#take(DOUBLE_BYTES);
    return this.#data.subarray(at, at + DOUBLE_BYTES);
  }

  skip(count: number): void {
    this.#take(count);
  }

  /** An `XLWideString` (§2.5.169): a 32-bit count of UTF-16 code units, then the units. */
  wideString(): string {
    return this.#characters(this.uint32());
  }

  /** An `XLNullableWideString` (§2.5.167): a wide string, or `null` for the all-ones count. */
  nullableWideString(): string | null {
    const count = this.uint32();
    return count === NULL_STRING ? null : this.#characters(count);
  }

  /**
   * A `RichStr` (§2.5.122): a flags byte, then its text. Formatting runs and a phonetic guide may
   * follow the text; the text is the characters, so they are left unread.
   */
  richString(): string {
    this.skip(1);
    return this.wideString();
  }

  #characters(count: number): string {
    const at = this.#take(count * CHARACTER_BYTES);
    return UTF16.decode(this.#data.subarray(at, at + count * CHARACTER_BYTES));
  }
}
