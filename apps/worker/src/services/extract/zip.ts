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
 * SO THIS IS DELIBERATELY NOT A ZIP LIBRARY. It reads members by exact name out of a
 * single-disk archive and does nothing else: no writing, no directory traversal, no streaming,
 * no encryption, no zip64. Each of those is a shape an OOXML part never has, and the way an
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

import { inflateRawSync } from "node:zlib";

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

interface Member {
  readonly method: number;
  readonly compressedBytes: number;
  readonly localOffset: number;
}

/** Members by name, in central-directory order. Empty when this is not a readable archive. */
export type ZipIndex = ReadonlyMap<string, Member>;

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

/**
 * Index the archive's members, or hand back an empty map.
 *
 * Empty rather than a throw because "these bytes are not a zip" is an ordinary answer about a
 * document -- a `.xlsx` that is really an HTML error page saved under the wrong name is a
 * thing a sync collects -- and the caller already has a column to record it in.
 */
export function readZipIndex(bytes: Uint8Array): ZipIndex {
  const members = new Map<string, Member>();
  if (bytes.byteLength < EOCD_BYTES) {
    return members;
  }

  const view = viewOf(bytes);
  const end = findEndRecord(view);
  if (end === null) {
    return members;
  }

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (at === ZIP64_SENTINEL) {
    return members; // Zip64. Not a shape an OOXML part has; refused rather than guessed at.
  }

  const names = new TextDecoder("utf-8");
  for (let seen = 0; seen < count; seen += 1) {
    if (at + CENTRAL_BYTES > view.byteLength || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      return members; // Truncated or not where the end record said. Keep what already parsed.
    }
    const nameBytes = view.getUint16(at + 28, true);
    const extraBytes = view.getUint16(at + 30, true);
    const commentBytes = view.getUint16(at + 32, true);
    const name = names.decode(bytes.subarray(at + CENTRAL_BYTES, at + CENTRAL_BYTES + nameBytes));

    members.set(name, {
      method: view.getUint16(at + 10, true),
      compressedBytes: view.getUint32(at + 20, true),
      localOffset: view.getUint32(at + 42, true),
    });

    at += CENTRAL_BYTES + nameBytes + extraBytes + commentBytes;
  }

  return members;
}

/**
 * One member's bytes, or `null` if they cannot be read exactly.
 *
 * The local header is consulted only for where the data begins: its size and method fields
 * are zero in an archive written with a data descriptor, which is why the central directory's
 * copies are the ones carried in `Member`.
 */
export function readZipMember(bytes: Uint8Array, member: Member): Uint8Array | null {
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
  if (stop > bytes.byteLength) {
    return null;
  }

  const raw = bytes.subarray(start, stop);
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
