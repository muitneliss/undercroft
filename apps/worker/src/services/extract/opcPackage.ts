/**
 * An Open Packaging Convention package (ECMA-376 Part 2): its parts by name, and the
 * relationships that say which part is which.
 *
 * An `.xlsx` and an `.xlsb` are both OPC packages. `_rels/.rels` names the main part, and the
 * main part's own `.rels` names each sheet, the shared strings and the styles -- whatever the
 * writer called them. Both workbook readers find their parts this way (ADR 0104 decision 4,
 * ADR 0109), so the rules for following a relationship live here once: a part name is matched
 * case-insensitively (Part 2 §9.1.1.1), an external target is a URL and never a part, a target
 * is resolved against the part that holds it, `..` and a leading `/` included, and a
 * relationship type is matched on its last segment, which the Transitional and Strict
 * vocabularies share.
 */

import {
  readZipIndex,
  readZipText,
  type StreamEnd,
  streamZipBytes,
  streamZipText,
  type ZipIndex,
} from "./zip.ts";
import { attributesOf } from "./xml.ts";

/** A part's text, opened afresh on each call and read as it inflates (`zip.ts`). */
export type PartStream = () => AsyncGenerator<string, StreamEnd>;

/** A part's bytes, opened afresh on each call and read as they inflate. */
export type PartBytes = () => AsyncGenerator<Uint8Array, StreamEnd>;

/** One relationship a part declares: its type's last segment, lowercased, and the part it names. */
export interface Relationship {
  readonly type: string;
  readonly part: string;
}

const ROOT_RELATIONSHIPS = "_rels/.rels";
const OFFICE_DOCUMENT = "officedocument";
const RELATIONSHIP = /<Relationship\b(?<attributes>[^>]*?)\/?>/gu;
const LEADING_SLASHES = /^\/+/u;

function lastSegment(type: string): string {
  return (type.split("/").at(-1) ?? "").toLowerCase();
}

/**
 * `xl/workbook.xml` → `xl/_rels/workbook.xml.rels`, where OPC keeps a part's relationships; the
 * package's own, the empty part's, are `_rels/.rels`.
 */
function relationshipsPartOf(part: string): string {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

function decodedTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    // A malformed escape is a name containing a `%`, which is legal; keep it as written.
    return target;
  }
}

/** A relationship target resolved against the part that holds it, `..` and `/` included. */
function resolve(fromPart: string, target: string): string {
  const decoded = decodedTarget(target);
  const base = decoded.startsWith("/") ? [] : fromPart.split("/").slice(0, -1);
  const segments: string[] = [...base];
  for (const segment of decoded.replace(LEADING_SLASHES, "").split("/")) {
    if (segment === "..") {
      segments.pop();
    } else if (segment !== "." && segment !== "") {
      segments.push(segment);
    }
  }
  return segments.join("/");
}

/** The part the first relationship of `type` names, if any does. */
export function partOfType(
  relationships: ReadonlyMap<string, Relationship>,
  type: string,
): string | undefined {
  return [...relationships.values()].find((relationship) => relationship.type === type)?.part;
}

/** The parts of one package, and the relationships between them. */
export class OpcPackage {
  readonly #bytes: Uint8Array;
  readonly #index: ZipIndex;
  readonly #names: ReadonlyMap<string, string>;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    this.#index = readZipIndex(bytes);
    this.#names = new Map([...this.#index.keys()].map((name) => [name.toLowerCase(), name]));
  }

  #actual(name: string): string | undefined {
    return this.#names.get(name.toLowerCase());
  }

  has(name: string): boolean {
    return this.#actual(name) !== undefined;
  }

  /** A part's text, read whole; `null` when it is absent or cannot be read exactly. */
  text(name: string): string | null {
    const actual = this.#actual(name);
    return actual === undefined ? null : readZipText(this.#bytes, this.#index, actual);
  }

  /** A part that may be larger than `text`'s ceiling, as a stream; `null` when absent. */
  stream(name: string): PartStream | null {
    const actual = this.#actual(name);
    return actual === undefined
      ? null
      : (): AsyncGenerator<string, StreamEnd> => streamZipText(this.#bytes, this.#index, actual);
  }

  /** A binary part as a stream of its bytes; `null` when absent. */
  bytes(name: string): PartBytes | null {
    const actual = this.#actual(name);
    return actual === undefined
      ? null
      : (): AsyncGenerator<Uint8Array, StreamEnd> =>
          streamZipBytes(this.#bytes, this.#index, actual);
  }

  /** Every part name, as stored. */
  names(): string[] {
    return [...this.#names.values()];
  }

  /** The main part `_rels/.rels` names, or `undefined` when the package names none. */
  mainPart(): string | undefined {
    return this.has(ROOT_RELATIONSHIPS)
      ? partOfType(this.relationships(""), OFFICE_DOCUMENT)
      : undefined;
  }

  /**
   * The relationships `part` declares, by id, each target resolved to the part it names. The
   * package's own (`_rels/.rels`) are the empty part's. External targets are left out.
   */
  relationships(part: string): ReadonlyMap<string, Relationship> {
    const xml = this.text(relationshipsPartOf(part));
    const relationships = new Map<string, Relationship>();
    for (const match of xml?.matchAll(RELATIONSHIP) ?? []) {
      const attributes = attributesOf(match.groups?.attributes ?? "");
      const id = attributes.get("Id");
      const type = attributes.get("Type");
      const target = attributes.get("Target");
      // An external target is a URL outside the package, never one of its parts.
      const internal = attributes.get("TargetMode") !== "External";
      if (id !== undefined && type !== undefined && target !== undefined && internal) {
        relationships.set(id, { type: lastSegment(type), part: resolve(part, target) });
      }
    }
    return relationships;
  }
}
