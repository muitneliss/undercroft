/**
 * The per-client Drive legs.
 *
 * - S->U compares each client folder Undercroft reads, file id by file id, on the fields its
 *   `files` record keeps; a second leg checks that every file of a type Undercroft reads has a
 *   stored document of the same byte size.
 * - S->O compares each client folder OSTWIN reads. OSTWIN keeps a Drive id for some rows (its
 *   legal inventory stores the Drive URL) and only a path for the rest, so a row joins by id
 *   when it has one and by its path relative to the client folder otherwise.
 * - O->U is asked only where both could hold the same file: Bookkeeping (same tree, joined by
 *   id), and Incorp files whose relative path exists in both the My Drive and the Shared drive
 *   copy. An OSTWIN file with no Shared drive counterpart is OUT_OF_SCOPE for Undercroft.
 *
 * NO CONCLUSION BEFORE THE RUN COMPLETES. A file absent from the lake is MISSING only when the
 * lake's last completed `files` run could have read it; while ingestion keeps failing, the leg
 * stays PENDING however many files are absent. md5 is compared, never used as identity.
 */

import { reconcileLeg } from "./classify.ts";
import { legCase, type LegMeta, makeCase, stamp } from "./cases.ts";
import type { DriveFile } from "./drive.ts";
import { type ClientDrive, modifiedBefore, type RootRead } from "./driveCommon.ts";
import type { DriveDeps, LakeSource } from "./driveLake.ts";
import { arrayOrEmpty, asObject, stringOrNull, text } from "./json.ts";
import type { FieldDiff, RecordResult, TestResult } from "./model.ts";
import type { LakeRecord } from "./undercroft.ts";

const GOOGLE_NATIVE = "application/vnd.google-apps.";

interface LakeFile {
  readonly md5Checksum: string | null;
  readonly size: string | null;
  readonly mimeType: string;
  readonly modifiedTime: string;
  readonly parents: readonly string[];
}

function lakeFile(record: LakeRecord): LakeFile {
  const payload = asObject(record.payload);
  return {
    md5Checksum: stringOrNull(payload.md5Checksum),
    size: payload.size === undefined || payload.size === null ? null : text(payload.size),
    mimeType: text(payload.mimeType),
    modifiedTime: text(payload.modifiedTime),
    parents: arrayOrEmpty(payload.parents).map(text).sort(),
  };
}

function compareLake(file: DriveFile, lake: LakeFile): FieldDiff[] {
  const pairs: readonly (readonly [string, string, string])[] = [
    ["mimeType", file.mimeType, lake.mimeType],
    ["md5Checksum", file.md5Checksum ?? "", lake.md5Checksum ?? ""],
    ["size", file.size ?? "", lake.size ?? ""],
    ["parents", [...file.parents].sort().join(","), lake.parents.join(",")],
    ["modifiedTime", String(Date.parse(file.modifiedTime)), String(Date.parse(lake.modifiedTime))],
  ];
  return pairs
    .filter(([, expected, actual]) => expected !== actual)
    .map(([field, expected, actual]) => ({ field, expected, actual }));
}

function inFileTypes(file: DriveFile, types: ReadonlySet<string>): boolean {
  const dot = file.name.lastIndexOf(".");
  const extension = dot <= 0 ? null : `.${file.name.slice(dot + 1).toLowerCase()}`;
  return types.has(file.mimeType) || (extension !== null && types.has(extension));
}

function notAsked(
  id: string,
  drive: ClientDrive,
  read: RootRead,
  why: { reason: string; blocked: boolean },
): TestResult {
  const { reason, blocked } = why;
  return makeCase(
    "drive",
    { id, title: `Drive ${read.root.role} vs Undercroft` },
    {
      leg: "S2U",
      client: drive.client.label,
      requirement: "REQ-DR-02 Undercroft holds every file of the client folders it reads",
      contract: "Undercroft drive connection scope",
      preconditions: "client folder exists in this root; lake readable",
      expected: blocked ? "comparison runs" : "not asked",
      actual: "not run",
      status: blocked ? "BLOCKED" : "OUT_OF_SCOPE",
      reason,
      evidence: [],
    },
  );
}

/** Why an S->U leg cannot run, or null when it can. */
function lakeUnavailable(
  id: string,
  drive: ClientDrive,
  read: RootRead,
  lake: LakeSource | undefined,
): TestResult | null {
  if (read.folders === 0) {
    return notAsked(id, drive, read, {
      reason: `the client has no ${read.root.role} folder; Undercroft's scope holds nothing of it here`,
      blocked: false,
    });
  }
  if (lake === undefined || lake.files === null || lake.documents === null) {
    return notAsked(id, drive, read, {
      reason: lake?.error ?? "lake source not read",
      blocked: true,
    });
  }
  return null;
}

export function legMeta(
  drive: ClientDrive,
  read: RootRead,
  meta: Omit<LegMeta, "source" | "client">,
): LegMeta {
  return {
    source: "drive",
    client: drive.client.label,
    ...meta,
    preconditions: `source tree complete=${read.complete}; ${meta.preconditions}`,
  };
}

export function s2uCase(deps: DriveDeps, drive: ClientDrive, read: RootRead): TestResult {
  const id = `DR-${drive.client.label}-S2U-${read.root.role}`;
  const lake = drive.lakes.get(read.root.undercroftSource ?? "");
  const unavailable = lakeUnavailable(id, drive, read, lake);
  if (unavailable !== null || lake === undefined) {
    return (
      unavailable ?? notAsked(id, drive, read, { reason: "lake source not read", blocked: true })
    );
  }
  const mark = lake.filesWatermark;
  const records = reconcileLeg({
    reference: read.files.map((file) => ({
      key: file.id,
      record: file,
      evidence: `drive:${file.id}`,
    })),
    target: read.files.flatMap((file) =>
      (lake.byId.get(file.id) ?? []).map((record) => ({
        key: file.id,
        record: lakeFile(record),
        evidence: `lake:${lake.source}/files/${file.id} run=${record.runId}`,
      })),
    ),
    inScope: () => ({ inScope: true, reason: "" }),
    synced: (file) => modifiedBefore(file, mark),
    compare: compareLake,
    targetBelongs: () => false,
  });
  const facts = {
    sourceFiles: read.files.length,
    googleNative: read.files.filter((file) => file.mimeType.startsWith(GOOGLE_NATIVE)).length,
    filesWatermark: stamp(mark),
  };
  const meta = legMeta(drive, read, {
    id,
    title: `Drive ${read.root.role} vs Undercroft files`,
    leg: "S2U",
    requirement: "REQ-DR-02 Undercroft holds every file of the client folders it reads",
    contract:
      "Undercroft drive files record: id, md5Checksum, mimeType, modifiedTime, parents, size",
    preconditions: `last completed files run ${stamp(mark)}`,
    expected: "every file present once, fields equal",
    facts,
  });
  return legCase(deps.sink, meta, records, read.complete && mark !== null);
}

/** Each file of the folder against its stored document, where the connection reads its type. */
function documentRecords(read: RootRead, lake: LakeSource): RecordResult[] {
  // A document is fetched for a file the files run listed: both runs must have completed.
  const mark =
    lake.documentsWatermark === null || lake.filesWatermark === null
      ? null
      : Math.min(lake.documentsWatermark, lake.filesWatermark);
  return reconcileLeg({
    reference: read.files.map((file) => ({
      key: file.id,
      record: file,
      evidence: `drive:${file.id}`,
    })),
    target: read.files.flatMap((file) => {
      const document = lake.documentIds.get(file.id);
      return document === undefined
        ? []
        : [
            {
              key: file.id,
              record: document,
              evidence: `lake:${lake.source}/documents/${file.id}`,
            },
          ];
    }),
    inScope: (file) => ({
      inScope: inFileTypes(file, lake.fileTypes),
      reason: `type ${file.mimeType} not in the connection's fileTypes`,
    }),
    synced: (file) => modifiedBefore(file, mark),
    // Bytes compare only for stored binaries; a Google-native file is exported, not copied.
    compare: (file, document) =>
      file.size === null ||
      file.mimeType.startsWith(GOOGLE_NATIVE) ||
      String(document.bytes) === file.size
        ? []
        : [{ field: "bytes", expected: file.size, actual: String(document.bytes) }],
    targetBelongs: () => false,
  });
}

export function documentsCase(deps: DriveDeps, drive: ClientDrive, read: RootRead): TestResult {
  const id = `DR-${drive.client.label}-DOC-${read.root.role}`;
  const lake = drive.lakes.get(read.root.undercroftSource ?? "");
  const unavailable = lakeUnavailable(id, drive, read, lake);
  if (unavailable !== null || lake === undefined) {
    return (
      unavailable ?? notAsked(id, drive, read, { reason: "lake source not read", blocked: true })
    );
  }
  const mark = lake.documentsWatermark;
  const records = documentRecords(read, lake);
  const meta = legMeta(drive, read, {
    id,
    title: `Drive ${read.root.role}: stored documents in Undercroft`,
    leg: "S2U",
    requirement: "REQ-DR-03 Undercroft stores the bytes of every file whose type it reads",
    contract: "Undercroft drive connection fileTypes; lake documents (documentId = Drive file id)",
    preconditions: `last completed documents run ${stamp(mark)}; files run ${stamp(lake.filesWatermark)}`,
    expected: "every in-type file stored once with its byte size",
    facts: {
      sourceFiles: read.files.length,
      inTypes: read.files.filter((file) => inFileTypes(file, lake.fileTypes)).length,
    },
  });
  return legCase(
    deps.sink,
    meta,
    records,
    read.complete && mark !== null && lake.filesWatermark !== null,
  );
}
