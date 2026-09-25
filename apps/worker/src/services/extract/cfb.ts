/**
 * Just enough of the Compound File Binary format to read named streams out of a legacy Office
 * file.
 *
 * A `.doc` is not a document so much as a small FAT filesystem in one file -- [MS-CFB], the
 * container Office used before OOXML replaced it with a zip. This module is to `doc.ts` what
 * `zip.ts` is to `docx.ts`, and it exists for the same reasons: the alternatives were
 * LibreOffice, which ADR 0028 and ADR 0036 both refused as "a container's worth of
 * dependency", or an npm parser in the one process that holds `UNDERCROFT_SECRET_KEY`, for a
 * read path this short. ADR 0053.
 *
 * SO THIS IS DELIBERATELY NOT A CFB LIBRARY. It reads the streams that are direct children of
 * the root storage, by name, and does nothing else: no writing, no nested storages, no
 * property sets. A Word file's text lives in `WordDocument` and `0Table`/`1Table`, both at the
 * root. A document EMBEDDED in it -- another `.doc` inside `ObjectPool` -- carries its own
 * `WordDocument` further down the tree, which is why the lookup walks the root's children
 * rather than scanning every directory entry for a name: a flat scan answers with whichever of
 * the two happens to come first.
 *
 * IT REFUSES RATHER THAN GUESSES (`CLAUDE.md` rule 2). A sector chain that loops or runs off
 * the end of the file, a sector size the spec does not allow, a stream longer than the chain
 * that holds it -- each comes back `null`, and the caller records a reason. A container reader
 * that returns its best effort hands the layer above a stream with a hole in it, which reads
 * exactly like a shorter document.
 */

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const HEADER_BYTES = 512;
const ENTRY_BYTES = 128;
const HEADER_DIFAT_ENTRIES = 109;

/** Version 3 files use 512-byte sectors, version 4 files 4096; the spec allows nothing else. */
const SECTOR_SHIFTS: ReadonlyMap<number, number> = new Map([
  [9, 512],
  [12, 4096],
]);
const MINI_SECTOR_SHIFT = 6;
const MINI_SECTOR_BYTES = 64;

/** Anything above this in a sector chain is a marker, not a sector. */
const MAX_REGULAR = 0xff_ff_ff_fa;
const END_OF_CHAIN = 0xff_ff_ff_fe;
const NO_ENTRY = 0xff_ff_ff_ff;

const STREAM = 2;
const ROOT = 5;

interface Entry {
  readonly name: string;
  readonly type: number;
  readonly left: number;
  readonly right: number;
  readonly child: number;
  readonly start: number;
  readonly size: number;
}

/** A run of fixed-size sectors inside `source`, where sector `n` starts at `offsetOf(n)`. */
interface Sectors {
  readonly source: Uint8Array;
  readonly bytes: number;
  readonly offsetOf: (sector: number) => number;
}

/** What `openCfb` hands back: the streams at the root, by name, read on demand. */
export interface Cfb {
  /** The named root stream's bytes, or `null` when there is none or it cannot be read exactly. */
  readonly stream: (name: string) => Uint8Array | null;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function words(bytes: Uint8Array): number[] {
  const view = viewOf(bytes);
  const out: number[] = [];
  for (let at = 0; at + 4 <= bytes.byteLength; at += 4) {
    out.push(view.getUint32(at, true));
  }
  return out;
}

/**
 * The sectors of one chain, in order, or `null` if it is not a chain.
 *
 * A chain longer than its table has visited a sector twice, which is a loop -- in a file from
 * a provider that is corruption or hostility, and following it would never return.
 */
function chain(table: readonly number[], start: number): number[] | null {
  const sectors: number[] = [];
  let at = start;
  while (at !== END_OF_CHAIN) {
    if (at > MAX_REGULAR || at >= table.length || sectors.length >= table.length) {
      return null;
    }
    sectors.push(at);
    at = table[at] ?? NO_ENTRY;
  }
  return sectors;
}

/** These sectors' bytes back to back, cut to `size`; `null` if the chain is short or leaves the file. */
function gather(from: Sectors, sectors: readonly number[] | null, size: number): Uint8Array | null {
  if (sectors === null || size > sectors.length * from.bytes) {
    return null;
  }
  const out = new Uint8Array(size);
  for (const [index, sector] of sectors.entries()) {
    const take = Math.min(from.bytes, size - index * from.bytes);
    const begin = from.offsetOf(sector);
    if (take <= 0) {
      break;
    }
    if (begin + take > from.source.byteLength) {
      return null;
    }
    out.set(from.source.subarray(begin, begin + take), index * from.bytes);
  }
  return out;
}

/** Every sector the FAT itself occupies: the header's first 109, then the DIFAT chain's. */
function fatSectors(file: Sectors, header: DataView): number[] | null {
  const count = header.getUint32(0x2c, true);
  const sectors = words(new Uint8Array(header.buffer, header.byteOffset + 0x4c, 436)).slice(
    0,
    Math.min(count, HEADER_DIFAT_ENTRIES),
  );
  const perSector = file.bytes / 4 - 1;
  let next = header.getUint32(0x44, true);
  for (let hops = 0; sectors.length < count; hops += 1) {
    const difat = next > MAX_REGULAR ? null : gather(file, [next], file.bytes);
    if (difat === null || hops > file.source.byteLength / file.bytes) {
      return null;
    }
    const entries = words(difat);
    sectors.push(...entries.slice(0, Math.min(perSector, count - sectors.length)));
    next = entries[perSector] ?? END_OF_CHAIN;
  }
  return sectors;
}

function readEntries(directory: Uint8Array, version: number): Entry[] {
  const view = viewOf(directory);
  const decoder = new TextDecoder("utf-16le");
  const entries: Entry[] = [];
  for (let base = 0; base + ENTRY_BYTES <= directory.byteLength; base += ENTRY_BYTES) {
    // The length is in bytes and counts the terminating NUL; 64 is the most the field holds.
    const nameBytes = Math.min(view.getUint16(base + 0x40, true), 64);
    // A version 3 size is 32 bits and its high half is unspecified -- some writers leave
    // garbage there, which is why the spec says to ignore it. A stream past 4 GiB cannot be in
    // a 25 MiB document, so a real high half saturates and fails the length check.
    const high = version === 3 ? 0 : view.getUint32(base + 0x7c, true);
    entries.push({
      name: decoder.decode(directory.subarray(base, base + Math.max(0, nameBytes - 2))),
      type: view.getUint8(base + 0x42),
      left: view.getUint32(base + 0x44, true),
      right: view.getUint32(base + 0x48, true),
      child: view.getUint32(base + 0x4c, true),
      start: view.getUint32(base + 0x74, true),
      size: high === 0 ? view.getUint32(base + 0x78, true) : Number.MAX_SAFE_INTEGER,
    });
  }
  return entries;
}

/**
 * The root's direct children, keyed by lowercased name because CFB compares names that way.
 *
 * They hang off the root's `child` as a red-black tree through `left`/`right`. The colour is
 * ignored -- a reader needs the nodes, not the balance -- and a node seen twice is a refusal,
 * because a tree with a cycle in it is not a tree.
 */
function rootChildren(entries: readonly Entry[]): Map<string, Entry> | null {
  const [root] = entries;
  if (root?.type !== ROOT) {
    return null;
  }
  const children = new Map<string, Entry>();
  const seen = new Set<number>();
  const pending = [root.child];
  for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
    if (at === NO_ENTRY) {
      continue;
    }
    const entry = entries[at];
    if (entry === undefined || seen.has(at)) {
      return null;
    }
    seen.add(at);
    children.set(entry.name.toLowerCase(), entry);
    pending.push(entry.left, entry.right);
  }
  return children;
}

/**
 * The mini stream: 64-byte sectors packed inside the root entry's own stream, where every
 * stream shorter than the cutoff lives, chained by a FAT of their own.
 */
function miniSectors(
  file: Sectors,
  fat: readonly number[],
  root: Entry,
  miniFatStart: number,
): { readonly sectors: Sectors; readonly table: readonly number[] } | null {
  const container = gather(file, chain(fat, root.start), root.size);
  const miniFatChain = chain(fat, miniFatStart);
  const miniFat =
    miniFatChain === null ? null : gather(file, miniFatChain, miniFatChain.length * file.bytes);
  if (container === null || miniFat === null) {
    return null;
  }
  const sectors: Sectors = {
    source: container,
    bytes: MINI_SECTOR_BYTES,
    offsetOf: (sector: number): number => sector * MINI_SECTOR_BYTES,
  };
  return { sectors, table: words(miniFat) };
}

/**
 * Open a compound file, or `null` if these bytes are not one this reader can trust.
 *
 * Only the header, the FAT and the directory are read up front; a stream is read when asked
 * for, so a caller that needs two streams out of a file holding twenty pays for two.
 */
export function openCfb(bytes: Uint8Array): Cfb | null {
  if (bytes.byteLength < HEADER_BYTES || SIGNATURE.some((byte, at) => bytes[at] !== byte)) {
    return null;
  }
  const header = viewOf(bytes);
  const sectorBytes = SECTOR_SHIFTS.get(header.getUint16(0x1e, true));
  if (sectorBytes === undefined || header.getUint16(0x20, true) !== MINI_SECTOR_SHIFT) {
    return null;
  }
  // The header is sector -1, so sector 0 begins one sector in.
  const file: Sectors = {
    source: bytes,
    bytes: sectorBytes,
    offsetOf: (sector: number): number => (sector + 1) * sectorBytes,
  };

  const fatChain = fatSectors(file, header);
  const fatBytes = fatChain === null ? null : gather(file, fatChain, fatChain.length * sectorBytes);
  const fat = fatBytes === null ? null : words(fatBytes);
  const directoryChain = fat === null ? null : chain(fat, header.getUint32(0x30, true));
  const directory =
    directoryChain === null
      ? null
      : gather(file, directoryChain, directoryChain.length * sectorBytes);
  if (fat === null || directory === null) {
    return null;
  }
  const entries = readEntries(directory, header.getUint16(0x1a, true));
  const children = rootChildren(entries);
  const [root] = entries;
  if (children === null || root === undefined) {
    return null;
  }
  const cutoff = header.getUint32(0x38, true);
  const miniFatStart = header.getUint32(0x3c, true);

  return {
    stream: (name: string): Uint8Array | null => {
      const entry = children.get(name.toLowerCase());
      if (entry?.type !== STREAM) {
        return null;
      }
      if (entry.size >= cutoff) {
        return gather(file, chain(fat, entry.start), entry.size);
      }
      const mini = miniSectors(file, fat, root, miniFatStart);
      return mini === null
        ? null
        : gather(mini.sectors, chain(mini.table, entry.start), entry.size);
    },
  };
}
