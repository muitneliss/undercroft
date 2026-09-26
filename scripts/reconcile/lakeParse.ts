/**
 * Parsing the Undercroft CLI's answers into typed rows. Every field is narrowed, never cast:
 * a shape the CLI changes is an error that names the shape, not a record that quietly drops.
 */

import { arrayOrEmpty, asObject, count, objectOrEmpty, stringOrNull, text } from "./json.ts";
import type {
  Connection,
  LakeDocument,
  LakeRecord,
  Run,
  SummaryDocuments,
  SummaryStream,
} from "./undercroft.ts";

export function parseStream(item: unknown): SummaryStream {
  const row = asObject(item);
  return {
    source: text(row.source),
    entity: text(row.entity),
    records: count(row.records),
    tombstoned: count(row.tombstoned),
    latestObservedAt: text(row.latestObservedAt),
  };
}

export function parseDocumentsSummary(item: unknown): SummaryDocuments {
  const row = asObject(item);
  return {
    source: text(row.source),
    documents: count(row.documents),
    readable: count(row.readable),
    refused: count(row.refused),
    waiting: count(row.waiting),
  };
}

export function parseConnection(item: unknown): Connection {
  const row = asObject(item);
  return {
    kind: text(row.kind),
    source: text(row.source),
    status: text(row.status),
    externalAccountLabel: text(row.externalAccountLabel),
    config: objectOrEmpty(row.config),
  };
}

export function parseRecord(item: unknown): LakeRecord {
  const row = asObject(item);
  const raw = row.payload;
  return {
    source: text(row.source),
    entity: text(row.entity),
    sourceRecordId: text(row.sourceRecordId),
    payload: typeof raw === "string" ? JSON.parse(raw) : raw,
    contentSha256: text(row.contentSha256),
    observedAt: text(row.observedAt),
    runId: text(row.runId),
    deletedAt: stringOrNull(row.deletedAt),
  };
}

export function parseDocument(item: unknown): LakeDocument {
  const row = asObject(item);
  return {
    source: text(row.source),
    documentId: text(row.documentId),
    contentType: text(row.contentType),
    bytes: count(row.bytes),
    sha256: text(row.sha256),
    observedAt: text(row.observedAt),
    runId: text(row.runId),
    deletedAt: stringOrNull(row.deletedAt),
  };
}

export function parseRun(item: unknown): Run {
  const row = asObject(item);
  const counts =
    row.counts === null || row.counts === undefined
      ? null
      : Object.fromEntries(
          Object.entries(asObject(row.counts)).map(([key, value]) => [key, count(value)]),
        );
  return {
    id: text(row.id),
    kind: text(row.kind),
    source: text(row.source),
    entities: arrayOrEmpty(row.entities).map(text),
    status: text(row.status),
    startedAt: text(row.startedAt),
    endedAt: stringOrNull(row.endedAt),
    counts,
    error: stringOrNull(row.error),
  };
}
