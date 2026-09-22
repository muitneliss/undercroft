/**
 * A real ZIP archive, written the way a writer writes one.
 *
 * The fixture the OOXML readers stand on. It is a real implementation of the container rather
 * than a stand-in for it (`tests.md`): genuine local headers, a genuine central directory, an
 * end record and real CRCs, with both compression methods available because both appear in the
 * wild -- Excel and Word deflate, and plenty of writers store small parts. A hand-made object
 * that skipped the container would make a broken zip parser look fine.
 *
 * IT IS FORMAT-AGNOSTIC, which is why it lives here rather than inside one suite. A member is
 * a name and a body: pass `xl/worksheets/sheet1.xml` and it is a workbook, pass
 * `word/document.xml` and it is a document. It was private to `xlsx.test.ts` until the `.docx`
 * reader needed it too, and sixty lines of zip-format detail in two copies is sixty lines that
 * drift -- one suite learns about data descriptors and the other does not.
 *
 * No committed binary fixture, therefore, and nothing to regenerate when a reader changes.
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
