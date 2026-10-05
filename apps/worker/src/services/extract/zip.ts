/**
 * Just enough of the ZIP container to read named members out of an OOXML file.
 *
 * WHY THIS EXISTS RATHER THAN A DEPENDENCY OR A BINARY. An `.xlsx` is a zip of XML, and the
 * two other ways to open one both cost more than they save here. A converter is either
 * LibreOffice -- which ADR 0028 rejected as "a container's worth of dependency for two
 * files" -- or one of `xlsx2csv`/`in2csv`, which are Python, and this repo
 * authors no Python (`CLAUDE.md`, "Language and runtime"). A npm zip library is a supply-chain
 * surface for the ~120 lines below, in the one process that holds `UNDERCROFT_SECRET_KEY`.
 *
 * SO THIS IS DELIBERATELY NOT A ZIP LIBRARY. It reads members out of a single-disk archive --
 * by exact name for OOXML, or as the directory lists them for an archive read for what it holds
 * (ADR 0108) -- and does nothing else: no writing, no path resolution, no decryption, no zip64. Each of those is a shape an OOXML part never has, and the way an
 * unused branch earns a CVE is by existing.
 *
 * IT REFUSES RATHER THAN GUESSES (`CLAUDE.md` rule 2). Every read that cannot be trusted --
 * a truncated header, a compression method nobody here implements, a zip64 sentinel, a member
 * that inflates past its ceiling -- comes back `null`, and the caller turns that into a
 * recorded reason. A zip reader that returns its best effort at a corrupt archive hands the
 * layer above a half-read spreadsheet that looks exactly like a short one.
 *
 * THE CENTRAL DIRECTORY IS THE AUTHORITY on a member's size and compression method, never the
 * local header: an archive written with a data descriptor (general-purpose flag bit 3, which
 * is what a streaming writer emits) carries zeroes in those local fields. The local header is
 * read for one thing only -- its own name and extra lengths, which is where the member's bytes
 * begin.
 */

import { createInflateRaw, inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06_05_4b_50;
const CENTRAL_SIGNATURE = 0x02_01_4b_50;
const LOCAL_SIGNATURE = 0x04_03_4b_50;

const EOCD_BYTES = 22;
const CENTRAL_BYTES = 46;
const LOCAL_BYTES = 30;

/** A zip comment is a 16-bit length, so the record starts within this much of the end. */
const MAX_COMMENT_BYTES = 0xff_ff;

const STORED = 0;
const DEFLATED = 8;

/** A 32-bit size field saturated at its maximum means the real value is in a zip64 extra. */
const ZIP64_SENTINEL = 0xff_ff_ff_ff;

/**
 * The ceiling on one inflated member.
 *
 * A document is already capped at 25 MiB (`landDocument.ts`), but deflate expands, so the
 * archive's own size bounds nothing: a few kilobytes of zeroes inflate to gigabytes, and the
 * worker holds each member whole in memory. `inflateRawSync` enforces this and raises when it
 * is passed, which arrives here as the same refusal a corrupt member gets.
 */
export const MAX_MEMBER_BYTES = 32 * 1024 * 1024;

export interface Member {
  readonly method: number;
  readonly compressedBytes: number;
  /** What the central directory says the member inflates to. A claim, checked by inflating. */
  readonly uncompressedBytes: number;
  readonly localOffset: number;
  /** Its stored bytes are ciphertext, which a stored member would otherwise pass off as itself. */
  readonly encrypted: boolean;
}

/** Members by name, in central-directory order. Empty when this is not a readable archive. */
export type ZipIndex = ReadonlyMap<string, Member>;

/** One member as the central directory lists it. */
export interface ListedMember {
  readonly name: string;
  readonly member: Member;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Where the end-of-central-directory record starts, scanning back from the end.
 *
 * Backwards because the record is last and variable-length: its trailing comment can be up to
 * 64 KiB, so its position is only knowable by looking for it.
 */
function findEndRecord(view: DataView): number | null {
  const earliest = Math.max(0, view.byteLength - EOCD_BYTES - MAX_COMMENT_BYTES);
  for (let at = view.byteLength - EOCD_BYTES; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) {
      return at;
    }
  }
  return null;
}

/** The central directory walked: every entry that parsed, and whether that was all of them. */
interface Directory {
  readonly listed: ListedMember[];
  readonly exact: boolean;
}

function walkDirectory(bytes: Uint8Array): Directory {
  const listed: ListedMember[] = [];
  if (bytes.byteLength < EOCD_BYTES) {
    return { listed, exact: false };
  }

  const view = viewOf(bytes);
  const end = findEndRecord(view);
  if (end === null) {
    return { listed, exact: false };
  }

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (at === ZIP64_SENTINEL) {
    return { listed, exact: false }; // Zip64: refused rather than guessed at.
  }

  const names = new TextDecoder("utf-8");
  for (let seen = 0; seen < count; seen += 1) {
    if (at + CENTRAL_BYTES > view.byteLength || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      return { listed, exact: false }; // Truncated or not where the end record said.
    }
    const nameBytes = view.getUint16(at + 28, true);
    const extraBytes = view.getUint16(at + 30, true);
    const commentBytes = view.getUint16(at + 32, true);
    const name = names.decode(bytes.subarray(at + CENTRAL_BYTES, at + CENTRAL_BYTES + nameBytes));

    listed.push({
      name,
      member: {
        method: view.getUint16(at + 10, true),
        compressedBytes: view.getUint32(at + 20, true),
        uncompressedBytes: view.getUint32(at + 24, true),
        localOffset: view.getUint32(at + 42, true),
        // General-purpose flag bit 0, the low bit: an odd flags word is an encrypted member.
        encrypted: view.getUint16(at + 8, true) % 2 === 1,
      },
    });

    at += CENTRAL_BYTES + nameBytes + extraBytes + commentBytes;
  }

  return { listed, exact: true };
}

/**
 * Index the archive's members, or hand back an empty map.
 *
 * Empty rather than a throw because "these bytes are not a zip" is an ordinary answer about a
 * document -- a `.xlsx` that is really an HTML error page saved under the wrong name is a
 * thing a sync collects -- and the caller already has a column to record it in. A directory
 * that breaks off part-way keeps what already parsed: an OOXML reader asks for named parts and
 * says which one is missing.
 */
export function readZipIndex(bytes: Uint8Array): ZipIndex {
  return new Map(walkDirectory(bytes).listed.map(({ name, member }) => [name, member]));
}

/**
 * Every member in central-directory order, or `null` unless the WHOLE directory was read.
 *
 * Stricter than {@link readZipIndex} on purpose: an archive is read for what it holds, and a
 * directory that broke off part-way would present the members before the break as all of
 * them (ADR 0108 decision 5).
 */
export function readZipListing(bytes: Uint8Array): readonly ListedMember[] | null {
  const directory = walkDirectory(bytes);
  return directory.exact ? directory.listed : null;
}

/** Where a member's stored bytes are, or `null` when the archive does not hold them exactly. */
function memberData(bytes: Uint8Array, member: Member): Uint8Array | null {
  if (member.compressedBytes === ZIP64_SENTINEL) {
    return null;
  }
  const view = viewOf(bytes);
  const header = member.localOffset;
  if (header + LOCAL_BYTES > view.byteLength || view.getUint32(header, true) !== LOCAL_SIGNATURE) {
    return null;
  }
  const start =
    header + LOCAL_BYTES + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
  const stop = start + member.compressedBytes;
  return stop > bytes.byteLength ? null : bytes.subarray(start, stop);
}

/**
 * One member's bytes, or `null` if they cannot be read exactly.
 *
 * The local header is consulted only for where the data begins: its size and method fields
 * are zero in an archive written with a data descriptor, which is why the central directory's
 * copies are the ones carried in `Member`.
 */
export function readZipMember(bytes: Uint8Array, member: Member): Uint8Array | null {
  const raw = member.encrypted ? null : memberData(bytes, member);
  if (raw === null) {
    return null;
  }
  if (member.method === STORED) {
    return raw.byteLength > MAX_MEMBER_BYTES ? null : raw;
  }
  if (member.method !== DEFLATED) {
    return null; // bzip2, LZMA, zstd. Legal zip, never an OOXML part.
  }
  try {
    return inflateRawSync(raw, { maxOutputLength: MAX_MEMBER_BYTES });
  } catch {
    // Corrupt stream, or past the ceiling. Both are "we cannot read this member exactly".
    return null;
  }
}

/** A member's UTF-8 text, or `null` if it is absent or unreadable. OOXML parts are all XML. */
export function readZipText(bytes: Uint8Array, index: ZipIndex, name: string): string | null {
  const member = index.get(name);
  if (member === undefined) {
    return null;
  }
  const raw = readZipMember(bytes, member);
  return raw === null ? null : new TextDecoder("utf-8").decode(raw);
}

/**
 * The ceiling on one member READ AS A STREAM: past this many inflated bytes the stream stops
 * and says so. It is not a memory bound -- a streamed member is never held whole -- but a
 * bound on the work a single part can demand, so a zip bomb costs seconds of inflating rather
 * than a run that never ends. Two gibibytes is several times the XML of a sheet at Excel's
 * own row limit. ADR 0106.
 */
export const MAX_STREAMED_BYTES = 2 * 1024 * 1024 * 1024;

/** How a streamed member ended: whole, stopped at the ceiling, or unreadable part-way. */
export type StreamEnd = "complete" | "too-large" | "unreadable";

/** Stored bytes are handed over in pieces of this size, so a stored part is never one string. */
const STORED_PIECE = 1024 * 1024;

async function* inflatedPieces(raw: Uint8Array, method: number): AsyncGenerator<Uint8Array> {
  if (method === STORED) {
    for (let at = 0; at < raw.byteLength; at += STORED_PIECE) {
      yield raw.subarray(at, at + STORED_PIECE);
    }
    return;
  }
  const inflater = createInflateRaw();
  // A Node stream iterates its chunks untyped; an inflater's are always Buffers.
  const pieces: AsyncIterable<Buffer> = inflater;
  try {
    inflater.end(raw);
    for await (const piece of pieces) {
      yield piece;
    }
  } finally {
    inflater.destroy();
  }
}

/**
 * A member's UTF-8 text in pieces as it inflates, never whole, and how the stream ended.
 *
 * For the one part that can be larger than `MAX_MEMBER_BYTES` and must still be read: a
 * worksheet (`sheetScan.ts`). A corrupt stream ends `unreadable` and a stream past `maxBytes`
 * ends `too-large`; the text already handed over was exact up to there, and the caller says the
 * part stopped short rather than presenting it as whole. Absent members are the caller's to
 * check; this answers `unreadable` for them too.
 */
export async function* streamZipText(
  bytes: Uint8Array,
  index: ZipIndex,
  name: string,
  maxBytes: number = MAX_STREAMED_BYTES,
): AsyncGenerator<string, StreamEnd> {
  const member = index.get(name);
  const raw = member === undefined || member.encrypted ? null : memberData(bytes, member);
  if (
    member === undefined ||
    raw === null ||
    (member.method !== STORED && member.method !== DEFLATED)
  ) {
    return "unreadable";
  }
  const decoder = new TextDecoder("utf-8");
  let total = 0;
  try {
    for await (const piece of inflatedPieces(raw, member.method)) {
      total += piece.byteLength;
      if (total > maxBytes) {
        return "too-large";
      }
      yield decoder.decode(piece, { stream: true });
    }
  } catch {
    return "unreadable";
  }
  const rest = decoder.decode();
  if (rest !== "") {
    yield rest;
  }
  return "complete";
}
