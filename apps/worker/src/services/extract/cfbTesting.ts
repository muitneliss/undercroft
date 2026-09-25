/**
 * A Compound File Binary container, written the way a writer writes one: the header, the FAT,
 * the directory, the mini FAT and the mini stream, and every stream's own sectors.
 *
 * The container half of `docTesting.ts`, as `cfb.ts` is the container half of the reader. It
 * writes only what the reader reads, and nothing about Word -- that is `docTesting.ts`'s.
 */

import { concat } from "./testing.ts";

const SECTOR = 512;
const PER_SECTOR = SECTOR / 4;
const MINI = 64;
const MINI_CUTOFF = 4096;
const FREE = 0xff_ff_ff_ff;
const END = 0xff_ff_ff_fe;
const FAT_SECTOR = 0xff_ff_ff_fd;
const HEADER_DIFAT = 109;
const ROOT = 5;
const EMPTY = new Uint8Array(0);

export interface CfbEntry {
  readonly name: string;
  /** 1 a storage, 2 a stream, 5 the root. */
  readonly type: number;
  readonly bytes?: Uint8Array;
  readonly child?: number;
  readonly right?: number;
}

function words32(values: readonly number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  for (const [at, value] of values.entries()) {
    view.setUint32(at * 4, value, true);
  }
  return out;
}

function sectorsOf(bytes: number): number {
  return Math.ceil(bytes / SECTOR);
}

function padded(bytes: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  out.set(bytes);
  return out;
}

function isSmall(entry: CfbEntry): boolean {
  return entry.bytes !== undefined && entry.bytes.length < MINI_CUTOFF;
}

/** Every stream under the cutoff, packed into 64-byte sectors, with their chains and starts. */
function packMini(entries: readonly CfbEntry[]): {
  stream: Uint8Array;
  chain: number[];
  starts: number[];
} {
  const parts: Uint8Array[] = [];
  const chain: number[] = [];
  const starts: number[] = [];
  for (const entry of entries) {
    const count = isSmall(entry) ? Math.ceil((entry.bytes?.length ?? 0) / MINI) : 0;
    starts.push(count === 0 ? END : chain.length);
    for (let at = 1; at <= count; at += 1) {
      chain.push(at === count ? END : chain.length + 1);
    }
    parts.push(padded(count === 0 ? EMPTY : (entry.bytes ?? EMPTY), count * MINI));
  }
  return { stream: concat(parts), chain, starts };
}

/** The FAT for regions laid end to end after it, and where each region starts. */
function allocate(regionSectors: readonly number[]): { fat: number[]; starts: number[] } {
  const total = regionSectors.reduce((sum, count) => sum + count, 0);
  let fatCount = 1;
  while (fatCount * PER_SECTOR < total + fatCount) {
    fatCount += 1;
  }
  const fat = new Array<number>(fatCount * PER_SECTOR).fill(FREE).fill(FAT_SECTOR, 0, fatCount);
  const starts: number[] = [];
  let next = fatCount;
  for (const count of regionSectors) {
    starts.push(count === 0 ? END : next);
    for (let at = 0; at < count; at += 1) {
      fat[next + at] = at === count - 1 ? END : next + at + 1;
    }
    next += count;
  }
  return { fat, starts };
}

function directoryOf(
  entries: readonly CfbEntry[],
  placement: readonly (readonly [number, number])[],
): Uint8Array {
  const directory = new Uint8Array(sectorsOf(entries.length * 128) * SECTOR);
  const view = new DataView(directory.buffer);
  for (const [at, entry] of entries.entries()) {
    const base = at * 128;
    for (let character = 0; character < entry.name.length; character += 1) {
      view.setUint16(base + character * 2, entry.name.charCodeAt(character), true);
    }
    view.setUint16(base + 0x40, (entry.name.length + 1) * 2, true);
    directory.set([entry.type, 1], base + 0x42);
    view.setUint32(base + 0x44, FREE, true);
    view.setUint32(base + 0x48, entry.right ?? FREE, true);
    view.setUint32(base + 0x4c, entry.child ?? FREE, true);
    const [start, size] = placement[at] ?? [END, 0];
    view.setUint32(base + 0x74, start, true);
    view.setUint32(base + 0x78, size, true);
  }
  return directory;
}

function headerOf(fatCount: number, starts: readonly number[], miniFatSectors: number): Uint8Array {
  if (fatCount > HEADER_DIFAT) {
    throw new Error("docOf: a fixture this large would need DIFAT sectors");
  }
  const header = new Uint8Array(SECTOR);
  const view = new DataView(header.buffer);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  for (const [at, value] of [0x3e, 3, 0xff_fe, 9, 6].entries()) {
    view.setUint16(0x18 + at * 2, value, true);
  }
  view.setUint32(0x2c, fatCount, true);
  view.setUint32(0x30, starts[0] ?? END, true);
  view.setUint32(0x38, MINI_CUTOFF, true);
  view.setUint32(0x3c, starts[1] ?? END, true);
  view.setUint32(0x40, miniFatSectors, true);
  view.setUint32(0x44, END, true);
  for (let at = 0; at < HEADER_DIFAT; at += 1) {
    view.setUint32(0x4c + at * 4, at < fatCount ? at : FREE, true);
  }
  return header;
}

/**
 * A version 3 compound file holding these directory entries, entry 0 being the root.
 *
 * Streams under the cutoff go in the mini stream and the rest in regular sectors, as the spec
 * requires -- a writer that put everything in one place would leave half the reader untested.
 * Sibling and child links are the caller's, so a caller can put an entry anywhere in the tree.
 */
export function cfbOf(entries: readonly CfbEntry[]): Uint8Array {
  const mini = packMini(entries);
  const miniFat = words32(mini.chain);
  const big = entries.map((entry) => (isSmall(entry) ? EMPTY : (entry.bytes ?? EMPTY)));
  const sizes = [
    entries.length * 128,
    miniFat.length,
    mini.stream.length,
    ...big.map((b) => b.length),
  ];
  const regionSectors = sizes.map(sectorsOf);
  const { fat, starts } = allocate(regionSectors);
  const placement = entries.map((entry, at): [number, number] => {
    if (entry.type === ROOT) {
      return [starts[2] ?? END, mini.stream.length];
    }
    const start = isSmall(entry) ? mini.starts[at] : starts[3 + at];
    return [start ?? END, entry.bytes?.length ?? 0];
  });
  const regions = [directoryOf(entries, placement), miniFat, mini.stream, ...big];
  return concat([
    headerOf(fat.length / PER_SECTOR, starts, regionSectors[1] ?? 0),
    words32(fat),
    ...regions.map((region, at) => padded(region, (regionSectors[at] ?? 0) * SECTOR)),
  ]);
}
