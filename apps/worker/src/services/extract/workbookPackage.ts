/**
 * Where a workbook's parts are, found the way the package says rather than by Excel's names.
 *
 * An `.xlsx` is an Open Packaging Convention package (ECMA-376 Part 2): `_rels/.rels` names the
 * workbook part, and the workbook part's own `.rels` names each sheet, the shared strings and
 * the styles. Excel happens to call them `xl/workbook.xml` and `xl/worksheets/sheetN.xml`, and
 * the reader used to look for exactly those names -- so a workbook from a writer that named its
 * parts differently, which the format allows, was refused as having no worksheet at all.
 * Following the relationships is also the only exact way to a sheet's NAME: `<sheet name>` in
 * the workbook part is bound to its part through them, and ADR 0028 declined to map a name to a
 * part by "sheet1 is usually the first tab". ADR 0104 decision 4.
 *
 * A PACKAGE WITH NO RELATIONSHIPS is still read, by Excel's conventional part names, because it
 * was read that way before and refusing it now would turn a readable workbook into a refusal.
 * What that path cannot know it says: every sheet's name is `null`, with
 * `workbook-relationships-missing` as the reason.
 *
 * Both the Transitional and the Strict (ISO/IEC 29500 Strict) vocabularies are accepted: they
 * differ in namespace URIs, and a relationship type is matched on its last segment, which the
 * two share.
 */

import { integerOf, numberFormatsOf } from "./numberFormats.ts";
import { readSharedStrings } from "./sharedStrings.ts";
import { attributesOf, PREFIX } from "./xml.ts";
import { readZipIndex, readZipText, type StreamEnd, streamZipText, type ZipIndex } from "./zip.ts";

/** Which container a workbook came from: an OOXML package, Strict or not, or a BIFF8 stream. */
export type Container = "ooxml" | "ooxml-strict" | "biff8";
export type SheetKind = "worksheet" | "chartsheet" | "dialogsheet" | "macrosheet";
export type SheetState = "visible" | "hidden" | "veryHidden";

/** Why a sheet's name is `null`. The only one: the package has no relationships to follow. */
export const NAMES_UNRESOLVED = "workbook-relationships-missing";

/** A part's text, opened afresh on each call and read as it inflates (`zip.ts`). */
export type PartStream = () => AsyncGenerator<string, StreamEnd>;

/** One sheet the workbook lists, in tab order, with a way to stream its part. */
export interface SheetPart {
  /** 1-based, in the order the workbook lists its sheets (its tab order). */
  readonly index: number;
  readonly name: string | null;
  readonly nameReason: string | null;
  /** `null` when the sheet's relationship names no part type this reader knows. */
  readonly kind: SheetKind | null;
  readonly state: SheetState;
  /** `null` when the package holds no part for it; a part that breaks part-way says so as it ends. */
  readonly stream: PartStream | null;
}

export interface WorkbookPackage {
  readonly container: Container;
  /** The workbook's date epoch; `null` only when the package holds no workbook part to say. */
  readonly date1904: boolean | null;
  readonly sheets: readonly SheetPart[];
  readonly sharedStrings: readonly string[];
  /** The number-format code a cell's style index carries, or `null` for General. */
  readonly numberFormat: (styleIndex: number) => string | null;
}

const ROOT_RELATIONSHIPS = "_rels/.rels";
const CONVENTIONAL_WORKBOOK = "xl/workbook.xml";
const CONVENTIONAL_SHARED_STRINGS = "xl/sharedStrings.xml";
const CONVENTIONAL_STYLES = "xl/styles.xml";
const CONVENTIONAL_SHEET = /^xl\/worksheets\/sheet(?<index>\d+)\.xml$/iu;

const RELATIONSHIP = /<Relationship\b(?<attributes>[^>]*?)\/?>/gu;
const STRICT_NAMESPACE = /purl\.oclc\.org\/ooxml\/spreadsheetml\/main/u;
const SHEET = new RegExp(`<${PREFIX}sheet\\b(?<attributes>[^>]*?)\\/?>`, "gu");
const WORKBOOK_PROPERTIES = new RegExp(`<${PREFIX}workbookPr\\b(?<attributes>[^>]*?)\\/?>`, "u");
const RELATIONSHIP_ID = /^[A-Za-z_][\w.-]*:id$/u;
const LEADING_SLASHES = /^\/+/u;

/** A relationship type's last segment, which Transitional and Strict share. */
const KIND_BY_TYPE: ReadonlyMap<string, SheetKind> = new Map([
  ["worksheet", "worksheet"],
  ["chartsheet", "chartsheet"],
  ["dialogsheet", "dialogsheet"],
  ["xlmacrosheet", "macrosheet"],
  ["xlintlmacrosheet", "macrosheet"],
]);

const STATES: ReadonlyMap<string, SheetState> = new Map([
  ["visible", "visible"],
  ["hidden", "hidden"],
  ["veryHidden", "veryHidden"],
]);

interface Relationship {
  readonly type: string;
  readonly target: string;
}

/** The parts of one package, looked up the case-insensitive way OPC names them (Part 2 §9.1.1.1). */
class Parts {
  readonly #bytes: Uint8Array;
  readonly #index: ZipIndex;
  readonly #names: ReadonlyMap<string, string>;

  constructor(bytes: Uint8Array, index: ZipIndex) {
    this.#bytes = bytes;
    this.#index = index;
    this.#names = new Map([...index.keys()].map((name) => [name.toLowerCase(), name]));
  }

  has(name: string): boolean {
    return this.#names.has(name.toLowerCase());
  }

  text(name: string): string | null {
    const actual = this.#names.get(name.toLowerCase());
    return actual === undefined ? null : readZipText(this.#bytes, this.#index, actual);
  }

  /** A part that may be larger than `readZipText`'s ceiling, as a stream; `null` when absent. */
  stream(name: string): PartStream | null {
    const actual = this.#names.get(name.toLowerCase());
    return actual === undefined
      ? null
      : (): AsyncGenerator<string, StreamEnd> => streamZipText(this.#bytes, this.#index, actual);
  }

  /** Every part name, as stored. */
  names(): string[] {
    return [...this.#names.values()];
  }
}

function relationshipsOf(xml: string | null): ReadonlyMap<string, Relationship> {
  const relationships = new Map<string, Relationship>();
  for (const match of xml?.matchAll(RELATIONSHIP) ?? []) {
    const attributes = attributesOf(match.groups?.attributes ?? "");
    const id = attributes.get("Id");
    const type = attributes.get("Type");
    const target = attributes.get("Target");
    // An external target is a URL outside the package, never one of its parts.
    const internal = attributes.get("TargetMode") !== "External";
    if (id !== undefined && type !== undefined && target !== undefined && internal) {
      relationships.set(id, { type: lastSegment(type), target });
    }
  }
  return relationships;
}

function lastSegment(type: string): string {
  return (type.split("/").at(-1) ?? "").toLowerCase();
}

/** `xl/workbook.xml` → `xl/_rels/workbook.xml.rels`, where OPC keeps a part's relationships. */
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

function targetOf(
  relationships: ReadonlyMap<string, Relationship>,
  type: string,
): string | undefined {
  return [...relationships.values()].find((relationship) => relationship.type === type)?.target;
}

function date1904Of(workbookXml: string | null): boolean | null {
  if (workbookXml === null) {
    return null;
  }
  const flag = attributesOf(WORKBOOK_PROPERTIES.exec(workbookXml)?.groups?.attributes ?? "").get(
    "date1904",
  );
  return flag === "1" || flag === "true";
}

function containerOf(workbookXml: string | null): Container {
  return workbookXml !== null && STRICT_NAMESPACE.test(workbookXml) ? "ooxml-strict" : "ooxml";
}

function stateOf(value: string | undefined): SheetState {
  return (value === undefined ? undefined : STATES.get(value)) ?? "visible";
}

function relationshipIdOf(attributes: ReadonlyMap<string, string>): string | undefined {
  for (const [name, value] of attributes) {
    if (RELATIONSHIP_ID.test(name)) {
      return value;
    }
  }
  return undefined;
}

/** The sheets a workbook part lists, each resolved through the workbook's relationships. */
function listedSheets(parts: Parts, workbookPart: string, workbookXml: string): SheetPart[] {
  const relationships = relationshipsOf(parts.text(relationshipsPartOf(workbookPart)));
  return [...workbookXml.matchAll(SHEET)].map((match, at) => {
    const attributes = attributesOf(match.groups?.attributes ?? "");
    const id = relationshipIdOf(attributes);
    const relationship = id === undefined ? undefined : relationships.get(id);
    const kind = relationship === undefined ? null : (KIND_BY_TYPE.get(relationship.type) ?? null);
    const part = relationship === undefined ? null : resolve(workbookPart, relationship.target);
    return {
      index: at + 1,
      name: attributes.get("name") ?? null,
      nameReason: null,
      kind,
      state: stateOf(attributes.get("state")),
      stream: kind === null || part === null ? null : parts.stream(part),
    };
  });
}

/** Excel's own part names, for a package that carries no relationships to follow. */
function conventionalSheets(parts: Parts): SheetPart[] {
  const found = parts
    .names()
    .map((name) => ({ name, at: integerOf(CONVENTIONAL_SHEET.exec(name)?.groups?.index) }))
    .filter((sheet): sheet is { name: string; at: number } => sheet.at !== null)
    .sort((a, b) => a.at - b.at);
  return found.map((sheet, at) => ({
    index: at + 1,
    name: null,
    nameReason: NAMES_UNRESOLVED,
    kind: "worksheet",
    state: "visible",
    stream: parts.stream(sheet.name),
  }));
}

/** Where a package's parts are, before the shared strings are read. */
interface Located {
  readonly workbookXml: string | null;
  readonly sheets: readonly SheetPart[];
  readonly sharedStrings: PartStream | null;
  readonly styles: string | null;
}

function viaRelationships(parts: Parts, workbookPart: string): Located | null {
  const workbookXml = parts.text(workbookPart);
  if (workbookXml === null) {
    return null;
  }
  const relationships = relationshipsOf(parts.text(relationshipsPartOf(workbookPart)));
  const shared = targetOf(relationships, "sharedstrings");
  const styles = targetOf(relationships, "styles");
  return {
    workbookXml,
    sheets: listedSheets(parts, workbookPart, workbookXml),
    sharedStrings: shared === undefined ? null : parts.stream(resolve(workbookPart, shared)),
    styles: styles === undefined ? null : parts.text(resolve(workbookPart, styles)),
  };
}

function viaConventionalNames(parts: Parts): Located {
  return {
    workbookXml: parts.text(CONVENTIONAL_WORKBOOK),
    sheets: conventionalSheets(parts),
    sharedStrings: parts.stream(CONVENTIONAL_SHARED_STRINGS),
    styles: parts.text(CONVENTIONAL_STYLES),
  };
}

/**
 * A workbook package opened, or `null` for bytes that hold no workbook: not a zip, a zip with no
 * sheet in it -- a `.docx` renamed, say -- or a shared string table that stops part-way. None is
 * an empty spreadsheet, and the caller records each as a reason (`CLAUDE.md` rule 2).
 */
export async function openWorkbookPackage(bytes: Uint8Array): Promise<WorkbookPackage | null> {
  const parts = new Parts(bytes, readZipIndex(bytes));
  const office = parts.has(ROOT_RELATIONSHIPS)
    ? targetOf(relationshipsOf(parts.text(ROOT_RELATIONSHIPS)), "officedocument")
    : undefined;
  const located =
    office === undefined
      ? viaConventionalNames(parts)
      : viaRelationships(parts, resolve("", office));
  if (located === null || located.sheets.length === 0) {
    return null;
  }
  // A workbook with no shared strings part keeps every text inline, which is not an error.
  const sharedStrings =
    located.sharedStrings === null ? [] : await readSharedStrings(located.sharedStrings());
  if (sharedStrings === null) {
    return null;
  }
  return {
    container: containerOf(located.workbookXml),
    date1904: date1904Of(located.workbookXml),
    sheets: located.sheets,
    sharedStrings,
    numberFormat: numberFormatsOf(located.styles),
  };
}
