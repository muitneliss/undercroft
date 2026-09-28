/**
 * Finding the lake's copy of each exported Xero document, and comparing the two. Pure: the
 * live suite turns each answer into one test.
 *
 * The export carries no Xero id, so a document is found by what it shows. Three keys are tried
 * in turn, each only on what the one before left unmatched:
 *
 * 1. type, number, contact, date and total;
 * 2. type, contact, date and total, for a document whose number was changed;
 * 3. type and number, for one whose contact, date or total was -- the comparison then says which.
 *
 * At keys 2 and 3 only a single candidate is taken. At key 1 several lake documents may share
 * one key: Xero can hold identical documents twice over, and the export writes them as one
 * run of rows, so they are compared as one group.
 */

import { byCode } from "./normalise.ts";
import type { ExportedContact, ExportedDocument, Line, XeroDocument } from "./xeroExport.ts";
import type { LakeContact, LakeDocument } from "./xeroLake.ts";

/** Why one document or contact does or does not match. */
export type Verdict =
  | { readonly kind: "same" }
  | { readonly kind: "different"; readonly fields: readonly string[] };

export interface Match {
  readonly source: ExportedDocument;
  readonly lake: readonly LakeDocument[];
}

export interface Matching {
  readonly matched: readonly Match[];
  readonly onlyExport: readonly ExportedDocument[];
  readonly onlyLake: readonly LakeDocument[];
}

type Key = (document: XeroDocument) => string | null;

const KEYS: readonly Key[] = [
  (d): string => [d.kind, d.number, d.contact, d.date, d.total].join("\u0000"),
  (d): string => [d.kind, d.contact, d.date, d.total].join("\u0000"),
  (d): string | null => (d.number === "" ? null : [d.kind, d.number].join("\u0000")),
];

function indexBy(documents: readonly LakeDocument[], key: Key): Map<string, LakeDocument[]> {
  const index = new Map<string, LakeDocument[]>();
  for (const document of documents) {
    const at = key(document);
    if (at !== null) {
      index.set(at, [...(index.get(at) ?? []), document]);
    }
  }
  return index;
}

/** One key's pass: what it matches, and the exported documents it leaves. */
function matchOnce(
  sources: readonly ExportedDocument[],
  lake: readonly LakeDocument[],
  key: Key,
  groups: boolean,
): { matched: Match[]; unmatched: ExportedDocument[]; taken: Set<LakeDocument> } {
  const index = indexBy(lake, key);
  const taken = new Set<LakeDocument>();
  const matched: Match[] = [];
  const unmatched: ExportedDocument[] = [];
  for (const source of sources) {
    const at = key(source);
    const candidates = (at === null ? [] : (index.get(at) ?? [])).filter((d) => !taken.has(d));
    if (candidates.length === 1 || (groups && candidates.length > 1)) {
      matched.push({ source, lake: candidates });
      for (const candidate of candidates) {
        taken.add(candidate);
      }
    } else {
      unmatched.push(source);
    }
  }
  return { matched, unmatched, taken };
}

export function matchDocuments(
  exported: readonly ExportedDocument[],
  lake: readonly LakeDocument[],
): Matching {
  const matched: Match[] = [];
  let sourceLeft: readonly ExportedDocument[] = exported;
  let lakeLeft: readonly LakeDocument[] = lake;
  for (const [level, key] of KEYS.entries()) {
    const pass = matchOnce(sourceLeft, lakeLeft, key, level === 0);
    matched.push(...pass.matched);
    sourceLeft = pass.unmatched;
    lakeLeft = lakeLeft.filter((document) => !pass.taken.has(document));
  }
  return { matched, onlyExport: sourceLeft, onlyLake: lakeLeft };
}

const LINE_PARTS = [
  "description",
  "quantity",
  "unit",
  "amount",
  "account",
  "tax",
  "taxAmount",
] as const;

function lineText(line: Line, part?: (typeof LINE_PARTS)[number]): string {
  return part === undefined
    ? LINE_PARTS.map((name) => line[name] ?? "(not compared)").join("\u0000")
    : (line[part] ?? "(not compared)");
}

function sameBag(a: readonly string[], b: readonly string[]): boolean {
  const left = [...a].sort(byCode);
  const right = [...b].sort(byCode);
  return left.length === right.length && left.every((value, at) => value === right[at]);
}

/**
 * Lines are compared as a bag: the export and the API need not list them in one order. When
 * the bags differ and hold as many lines each, the parts that differ are named (`line.unit`);
 * otherwise the difference is in the number of lines.
 */
function lineDifferences(source: readonly Line[], lake: readonly Line[]): string[] {
  if (
    sameBag(
      source.map((line) => lineText(line)),
      lake.map((line) => lineText(line)),
    )
  ) {
    return [];
  }
  if (source.length !== lake.length) {
    return ["lines"];
  }
  return LINE_PARTS.filter(
    (part) =>
      !sameBag(
        source.map((line) => lineText(line, part)),
        lake.map((line) => lineText(line, part)),
      ),
  ).map((part) => `line.${part}`);
}

function fieldDifferences(
  source: Readonly<Record<string, string>>,
  lake: Readonly<Record<string, string>>,
): string[] {
  const names = new Set([...Object.keys(source), ...Object.keys(lake)]);
  return [...names].filter((name) => source[name] !== lake[name]).sort(byCode);
}

/**
 * One exported document against the lake's copy of it: every header field, then the lines.
 *
 * A tax-inclusive document's unit price includes tax in Xero and not in the export, so it is
 * left out on both sides; its line amount is compared before tax. A group of identical lake
 * documents is compared as one: the first one's header, every one's lines, and a difference
 * between the copies is a difference too.
 */
export function compareDocument(source: XeroDocument, lake: readonly LakeDocument[]): Verdict {
  const [first] = lake;
  if (first === undefined) {
    return { kind: "different", fields: ["(missing)"] };
  }
  const differ = fieldDifferences(source.fields, first.fields);
  if (lake.some((copy) => fieldDifferences(first.fields, copy.fields).length > 0)) {
    differ.push("(copies differ)");
  }
  const sourceLines = first.inclusive
    ? source.lines.map((line) => ({ ...line, unit: null }))
    : source.lines;
  differ.push(
    ...lineDifferences(
      sourceLines,
      lake.flatMap((copy) => copy.lines),
    ),
  );
  return differ.length === 0 ? { kind: "same" } : { kind: "different", fields: differ };
}

export function compareContact(source: ExportedContact, lake: LakeContact): Verdict {
  const differ = fieldDifferences(source.fields, lake.fields);
  return differ.length === 0 ? { kind: "same" } : { kind: "different", fields: differ };
}
