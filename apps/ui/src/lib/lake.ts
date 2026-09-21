/**
 * The raw lake as the Lake division reads it: which streams exist, which one is open, and
 * what the leaf says when nothing has landed.
 *
 * A stream is one (source, entity) of records or one source's document catalogue, and the
 * open one lives in the URL -- `?source=hubspot&entity=deals`, `?documents=gmail` -- so a
 * page an admin pastes to a colleague opens on the same rows. The `<select>` that chooses it
 * needs a single string per option; `streamKey` and `streamFromKey` are that string and its
 * inverse, and they are private to the control in the sense that nothing else reads them.
 *
 * Words come from `t`; every decision that needs none is its own wordless function.
 */

import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import type { Connection, LakeSummary, RawSearchHit } from "@/api/types.ts";
import { firstRun, sourceLabel } from "@/lib/runs.ts";
import { formatDate, formatDateTime } from "@/lib/when.ts";

export type LakeStream =
  | { kind: "records"; source: string; entity: string }
  | { kind: "documents"; source: string };

/** Every stream the summary counted, records first, in the summary's own order. */
export function streamsOf(summary: LakeSummary): LakeStream[] {
  return [
    ...summary.records.map(
      (s): LakeStream => ({ kind: "records", source: s.source, entity: s.entity }),
    ),
    ...summary.documents.map((d): LakeStream => ({ kind: "documents", source: d.source })),
  ];
}

/**
 * What a stream holds beyond its count, as a fact rather than a formatted phrase.
 *
 * Records and documents are counted in different things, and the figure beside the count
 * means something different for each: rows the source has since deleted, against bytes on
 * disk. Printing both under one column heading would be the kind of quiet lie this codebase
 * refuses elsewhere, so the VALUE carries its own word and the column heading stays neutral.
 * The wording is the component's, through `t`; this stays wordless.
 */
export type LakeNote =
  | { kind: "tombstoned"; count: number }
  | { kind: "bytes"; bytes: number; readable: number; total: number }
  | { kind: "none" };

/** One line of the index: a stream, how much of it there is, and when it last moved. */
export interface LakeEntry {
  readonly stream: LakeStream;
  /** Rows, or documents. The unit is the stream's kind.  */
  readonly held: number;
  readonly note: LakeNote;
  readonly latestObservedAt: string;
}

/**
 * Every stream as ONE list, records first.
 *
 * One list rather than the two tables this leaf used to print, because "what have I got"
 * is one question and a reader answering it from two tables with different columns has to
 * hold both in their head to answer it. The order is the summary's own.
 */
export function inventoryOf(summary: LakeSummary): LakeEntry[] {
  return [
    ...summary.records.map(
      (s): LakeEntry => ({
        stream: { kind: "records", source: s.source, entity: s.entity },
        held: s.records,
        note:
          s.tombstoned > 0
            ? { kind: "tombstoned", count: s.tombstoned }
            : ({ kind: "none" } as const),
        latestObservedAt: s.latestObservedAt,
      }),
    ),
    ...summary.documents.map(
      (d): LakeEntry => ({
        stream: { kind: "documents", source: d.source },
        held: d.documents,
        note: { kind: "bytes", bytes: d.bytes, readable: d.readable, total: d.documents },
        latestObservedAt: d.latestObservedAt,
      }),
    ),
  ];
}

/** Whether two streams name the same thing. The index marks the open one with it. */
export function sameStream(a: LakeStream, b: LakeStream | null): boolean {
  return b !== null && streamKey(a) === streamKey(b);
}

const KEY_SEP = "|";

export function streamKey(stream: LakeStream): string {
  return stream.kind === "records"
    ? ["records", stream.source, stream.entity].join(KEY_SEP)
    : ["documents", stream.source].join(KEY_SEP);
}

export function streamFromKey(key: string): LakeStream | null {
  const [kind, source, entity] = key.split(KEY_SEP);
  if (kind === "records" && source !== undefined && source !== "" && entity !== undefined) {
    return entity === "" ? null : { kind, source, entity };
  }
  if (kind === "documents" && source !== undefined && source !== "") {
    return { kind, source };
  }
  return null;
}

/** The stream the URL names, or null when it names none. */
export function parseStream(params: URLSearchParams): LakeStream | null {
  const documents = params.get("documents");
  if (documents !== null && documents !== "") {
    return { kind: "documents", source: documents };
  }
  const source = params.get("source");
  const entity = params.get("entity");
  if (source !== null && source !== "" && entity !== null && entity !== "") {
    return { kind: "records", source, entity };
  }
  return null;
}

/** The URL's search for a stream: the inverse of `parseStream`. */
export function streamParams(stream: LakeStream): Record<string, string> {
  return stream.kind === "records"
    ? { source: stream.source, entity: stream.entity }
    : { documents: stream.source };
}

/**
 * Where a search hit is, as a line a reader can act on: `HubSpot · deals · d-1`.
 *
 * Wordless, because it is made of the source's own name and the source's own ids and none of
 * those are ours to translate (`i18n.md`). Which KIND of thing it is is a word, and is said
 * separately by the component beside this.
 */
export function hitWhere(hit: RawSearchHit): string {
  return hit.kind === "record"
    ? `${sourceLabel(hit.source)} · ${hit.entity} · ${hit.sourceRecordId}`
    : `${sourceLabel(hit.source)} · ${hit.documentId}`;
}

/**
 * What else a hit needs to say, in order, or nothing.
 *
 * A document says HOW it was read, because an OCR'd scan is a likelier place for a near-miss
 * than an extracted text layer and a reader judging a result deserves to know which of the two
 * they are looking at; one the extractor could read nothing from says that instead of going
 * quiet. A document cut short at extraction says so, because the part that was not read is also
 * the part that was not searched -- a truncated document that does not admit it reads as a
 * complete one that simply lacks the clause.
 *
 * A row the source has since deleted says so in both kinds. Search returns tombstones
 * deliberately -- "which contract said this" is asked about terminated contracts more often
 * than live ones -- and a tombstone that read as current would be the quiet lie this codebase
 * refuses everywhere else.
 */
export function hitNotes(t: TFunction, hit: RawSearchHit, locale: Locale): string[] {
  const notes: string[] = [];
  if (hit.kind === "document") {
    notes.push(
      hit.method === null
        ? t("lake.searchMethodUnknown")
        : t("lake.searchMethod", { method: hit.method }),
    );
    if (hit.truncated) {
      notes.push(t("lake.searchTruncated"));
    }
  }
  if (hit.deletedAt !== null) {
    notes.push(t("lake.deletedOn", { when: formatDate(hit.deletedAt, locale) }));
  }
  return notes;
}

/** `HubSpot · deals`, `Gmail · tài liệu`: the vendor's name, then what the stream holds. */
export function streamLabel(t: TFunction, stream: LakeStream): string {
  const what = stream.kind === "records" ? stream.entity : t("lake.streamDocuments");
  return `${sourceLabel(stream.source)} · ${what}`;
}

export function lakeEmptyBody(
  t: TFunction,
  locale: Locale,
  connections: readonly Pick<Connection, "nextRunAt">[],
  now: Date = new Date(),
): string {
  const first = firstRun(connections, now);
  switch (first.kind) {
    case "none":
      return t("lake.emptyBodyNoSchedule");
    case "due-now":
      return t("lake.emptyBodyDueNow");
    case "at":
      return t("lake.emptyBody", { when: formatDateTime(first.at, locale) });
    default: {
      const exhaustive: never = first;
      return exhaustive;
    }
  }
}
