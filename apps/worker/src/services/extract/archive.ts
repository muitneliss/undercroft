/**
 * A zip read for what it holds: which of its members become documents, and which are refused
 * and why. ADR 0108.
 *
 * READING DECIDES, LANDING DOES. This module only answers what the archive holds -- a member's
 * position, its catalogue type from its name, its declared size, and a refusal where one is
 * owed -- and hands each member's bytes over lazily, so nothing is inflated that the pass does
 * not land. Landing them is `archiveMembers.ts`, through the same document sink an ingest uses.
 *
 * A MEMBER'S NAME IS ITS ONLY LABEL. No provider declared a type for it, so its extension must
 * name a format in the catalogue (`memberTypeOf`); one that names none is left in the archive
 * and counted, as an unchosen attachment is. The name itself never reaches Postgres (`pii.md`):
 * the archive's text is empty, and a member is known by its position.
 */

import { memberTypeOf } from "@undercroft/contracts";

import { type Extracted, read, refused, UNSUPPORTED_TYPE } from "./extracted.ts";
import { readZipListing, readZipMember } from "./zip.ts";

/** The central directory could not be read whole: zip64, truncated, or not a zip at all. */
export const ARCHIVE_UNREADABLE = "archive-unreadable";
/** The member's bytes are encrypted, so its stored bytes are not its content. */
export const MEMBER_ENCRYPTED = "archive-member-encrypted";
/** A compression method nobody here implements, or a stream that does not inflate. */
export const MEMBER_UNREADABLE = "archive-member-unreadable";
/** An archive inside an archive, refused so a zip holding itself cannot expand forever. */
export const ARCHIVE_NESTED = "archive-nested";
/** Past {@link MAX_ARCHIVE_MEMBERS} members landed from one archive. */
export const MEMBERS_LIMIT = "archive-members-limit";

/** Members landed from one archive. Each becomes a read on a later pass. */
export const MAX_ARCHIVE_MEMBERS = 1000;

/** The part every OPC package carries: a `.docx`, an `.xlsb`, a `.vsdx` -- a file, not a folder. */
const CONTENT_TYPES = "[Content_Types].xml";

/** What Finder writes beside every file it zips: resource forks, never documents. */
const RESOURCE_FORK = /(?:^|\/)(?:__MACOSX\/|\._)/u;

/** One member the archive holds in a format the catalogue knows. */
export interface ArchiveMember {
  /** 1-based, in central-directory order. Its identity: the name is a person's words. */
  readonly position: number;
  readonly name: string;
  /** The catalogue type its extension names. */
  readonly type: string;
  /** What the directory says it inflates to, in decimal digits, for the sink's ceiling. */
  readonly declaredBytes: string;
  /** Why it will not land, or `null` when it will. */
  readonly refusal: string | null;
  /** Its bytes, inflated on asking; `null` when they cannot be read exactly. */
  readonly bytes: () => Uint8Array | null;
}

export interface Archive {
  readonly members: readonly ArchiveMember[];
  /** Members whose extension names no format in the catalogue: left where they are. */
  readonly leftInArchive: number;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function refusalOf(type: { archive: boolean }, encrypted: boolean, landing: number): string | null {
  if (type.archive) {
    return ARCHIVE_NESTED;
  }
  if (encrypted) {
    return MEMBER_ENCRYPTED;
  }
  return landing >= MAX_ARCHIVE_MEMBERS ? MEMBERS_LIMIT : null;
}

/** A zip's members as documents to land, or the archive refused whole. */
export function readArchive(bytes: Uint8Array): Extracted {
  const listing = readZipListing(bytes);
  if (listing === null) {
    return refused(ARCHIVE_UNREADABLE);
  }
  if (listing.some(({ name }) => name === CONTENT_TYPES)) {
    // A package is one document in a format of its own, and its parts are not files anybody
    // sent: expanded, its XML parts would land as documents. The workbook one is read before
    // this; any other is a type nobody reads, as it was.
    return refused(UNSUPPORTED_TYPE);
  }

  const members: ArchiveMember[] = [];
  let leftInArchive = 0;
  let landing = 0;
  for (const [at, { name, member }] of listing.entries()) {
    if (name.endsWith("/") || RESOURCE_FORK.test(name)) {
      continue; // A directory entry, or a resource fork: neither is a document.
    }
    const type = memberTypeOf(baseName(name));
    if (type === null) {
      leftInArchive += 1;
      continue;
    }
    const refusal = refusalOf(type, member.encrypted, landing);
    if (refusal === null) {
      landing += 1;
    }
    members.push({
      position: at + 1,
      name,
      type: type.type,
      declaredBytes: String(member.uncompressedBytes),
      refusal,
      bytes: () => readZipMember(bytes, member),
    });
  }

  return { ...read("zip", ""), archive: { members, leftInArchive } };
}
