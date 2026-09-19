/**
 * Google Drive: matching files from what the admin picked, into the lake.
 *
 * The scope is `drive.file`, not `drive.readonly`, and that is a security decision rather
 * than a preference. `drive.file` grants access only to items the user chose through the
 * Google Picker, so "the files you select, of the types you allow. No other folder is read"
 * -- copy this product already ships -- is enforced by Google rather than by our own `q=`
 * filter. It is also not a Google "restricted" scope, so it needs no annual CASA assessment.
 *
 * A consequence worth stating: a listing here cannot see anything that was not picked, so a
 * wrong filter fails closed. The filter is still written narrowly, because failing closed is
 * a backstop and not an excuse.
 *
 * **Descent is one level.** A folder's children are listed; a child folder's children are
 * not. Recursive descent through a shared drive can reach folders the admin never saw in
 * the Picker, which would make the printed promise false even where Google would allow the
 * read.
 *
 * **Which types are allowed is a second, independent filter**, on top of folder-boundedness:
 * `scope.fileTypes` (empty means every type, the same recorded-decision idiom as an empty
 * label or entity list -- `@undercroft/contracts`). A folder listing asks Google's `q=` for
 * only the allowed types; a directly-picked single file is checked after the fact, because
 * there is nothing to filter a lookup of one specific id by.
 */

import { type DriveScope, allowsFileType } from "@undercroft/contracts";
import { canonicalJson, getPath, getStringPath } from "@undercroft/core";

import type { DocumentToLand } from "../landDocument.ts";
import type { RecordToLand } from "../land.ts";
import { type RunJournal, SILENT_JOURNAL } from "../runJournal.ts";
import type { GoogleApi } from "./api.ts";

/** Why a pick was not taken. The one reason this collector has, and it is a refusal. */
export const NOT_ALLOWED_TYPE = "not-an-allowed-type";

const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";
const ENTITY = "files";
const PAGE_SIZE = "100";
const FIELDS = "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,parents)";
const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,md5Checksum,parents";

export interface DriveHarvest {
  readonly records: RecordToLand[];
  readonly documents: DocumentToLand[];
  /** Every document id this run saw, so the caller can tombstone what vanished. */
  readonly seenIds: string[];
  /**
   * What was picked and not taken, with why.
   *
   * A directly-picked file outside the allow-list used to be dropped where it was found,
   * which made "we were given nothing" and "we refused what we were given" the same green
   * run landing 0. CLAUDE.md rule 2: recorded with its reason, never dropped.
   */
  readonly skipped: { fileId: string; reason: string }[];
}

export function driveBaseUrl(): string {
  return DRIVE_BASE;
}

export async function harvestDrive(
  api: GoogleApi,
  scope: DriveScope,
  journal: RunJournal = SILENT_JOURNAL,
): Promise<DriveHarvest> {
  const records: RecordToLand[] = [];
  const documents: DocumentToLand[] = [];
  const seen = new Set<string>();
  const skipped: DriveHarvest["skipped"] = [];
  let folders = 0;

  for (const picked of scope.files) {
    if (picked.kind === "folder") {
      folders += 1;
    }
    const files = await matchingFilesOf(api, picked, {
      fileTypes: scope.fileTypes,
      seen: records.length,
      skipped,
    });

    for (const file of files) {
      if (seen.has(file.id)) {
        continue; // One file picked twice, or in two picked folders.
      }
      seen.add(file.id);

      records.push(toRecord(file));
      documents.push(toDocument(api, file, picked, records.length));
    }
  }

  // The sentence a green run landing nothing could not say before: what was looked in, what
  // was found there, and the one-level rule that explains the difference between them.
  journal.info("picks_listed", {
    entity: ENTITY,
    folders,
    picks: scope.files.length,
    matched: records.length,
    skipped: skipped.length,
  });

  return { records, documents, seenIds: [...seen], skipped };
}

/** The row that lands in `raw.records`: Drive's own facts about the file, canonicalised. */
function toRecord(file: DriveFile): RecordToLand {
  return {
    entity: ENTITY,
    sourceRecordId: file.id,
    sourceUpdatedAt: file.modifiedTime === "" ? null : file.modifiedTime,
    payloadText: canonicalJson({
      id: file.id,
      mimeType: file.mimeType,
      size: file.size,
      modifiedTime: file.modifiedTime,
      md5Checksum: file.md5Checksum,
      parents: file.parents,
    }),
  };
}

/**
 * The document that lands in the lake, and the split that keeps names out of Postgres.
 *
 * `metadata` reaches dbt and therefore a dashboard: ids, types and counts only. `manifest`
 * reaches the lake alone, which dbt and BI cannot read, and is where everything a person
 * named goes. Two arguments rather than one object, so the boundary is visible here. ADR 0015.
 */
function toDocument(
  api: GoogleApi,
  file: DriveFile,
  picked: DriveScope["files"][number],
  seen: number,
): DocumentToLand {
  return {
    documentId: file.id,
    contentType: file.mimeType,
    declaredBytes: file.size,
    metadata: {
      mimeType: file.mimeType,
      parents: file.parents, // Folder ids, not folder names.
      pickedVia: picked.kind,
    },
    manifest: {
      filename: file.name,
      pickedFrom: picked.name,
      fileId: file.id,
    },
    sourceUpdatedAt: file.modifiedTime === "" ? null : file.modifiedTime,
    fetchBytes: () =>
      api.getBytes(`${DRIVE_BASE}/${encodeURIComponent(file.id)}?alt=media`, ENTITY, seen),
  };
}

/**
 * The matching files one pick yields: a folder's, listed one level down, or the single file
 * itself.
 *
 * A pick that yields nothing because it is outside the allow-list is appended to `skipped`
 * rather than returned empty, so the caller can refuse it with a reason instead of landing a
 * silent zero.
 */
async function matchingFilesOf(
  api: GoogleApi,
  picked: DriveScope["files"][number],
  options: { fileTypes: readonly string[]; seen: number; skipped: DriveHarvest["skipped"] },
): Promise<DriveFile[]> {
  const { fileTypes, seen, skipped } = options;
  if (picked.kind === "folder") {
    return listMatchingIn(api, picked.id, fileTypes, seen);
  }
  const one = await readOneFile(api, picked.id, fileTypes, seen);
  if (one.file === null) {
    skipped.push({ fileId: picked.id, reason: one.reason });
    return [];
  }
  return [one.file];
}

interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: string;
  readonly modifiedTime: string;
  readonly md5Checksum: string;
  readonly parents: string[];
}

/**
 * A value for Drive's query syntax, escaped.
 *
 * The folder id needs none of this -- it is Google-issued and opaque, and `'` is not in its
 * alphabet -- but a file type can now come from the free-text field an admin typed into, and
 * that IS ordinary text.
 */
function escapeDriveQueryValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

/** "" for every type, one bare clause for one type, a parenthesized OR for several. */
function mimeTypeClause(fileTypes: readonly string[]): string {
  if (fileTypes.length === 0) {
    return "";
  }
  const clauses = fileTypes.map((type) => `mimeType='${escapeDriveQueryValue(type)}'`).join(" or ");
  if (fileTypes.length === 1) {
    return clauses;
  }
  return `(${clauses})`;
}

async function listMatchingIn(
  api: GoogleApi,
  folderId: string,
  fileTypes: readonly string[],
  seen: number,
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | null = null;
  const typeClause = mimeTypeClause(fileTypes);
  const q =
    typeClause === ""
      ? `'${folderId}' in parents and trashed=false`
      : `'${folderId}' in parents and ${typeClause} and trashed=false`;

  do {
    const url = new URL(DRIVE_BASE);
    url.searchParams.set("q", q);
    url.searchParams.set("fields", FIELDS);
    url.searchParams.set("pageSize", PAGE_SIZE);
    // A picked folder may live in a shared drive; without these the listing is silently
    // empty there, which reads as "the folder has nothing in it".
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken !== null) {
      url.searchParams.set("pageToken", pageToken);
    }

    const page = await api.getJson(url.toString(), ENTITY, seen);
    for (const raw of asArray(getPath(page, "files"))) {
      files.push(toFile(raw));
    }
    const next = str(page, "nextPageToken");
    pageToken = next === "" ? null : next;
  } while (pageToken !== null);

  return files;
}

/**
 * A directly picked file, or the reason it is not one we may take.
 *
 * A file outside the allow-list is refused: the consent says which types may be read. The
 * refusal is RETURNED rather than swallowed so the caller can record it -- an admin who
 * picked a spreadsheet nobody allowed is owed the sentence "that pick is not an allowed type"
 * and not a run that quietly landed nothing.
 */
async function readOneFile(
  api: GoogleApi,
  fileId: string,
  fileTypes: readonly string[],
  seen: number,
): Promise<{ file: DriveFile | null; reason: string }> {
  const url = new URL(`${DRIVE_BASE}/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", FILE_FIELDS);
  url.searchParams.set("supportsAllDrives", "true");

  const file = toFile(await api.getJson(url.toString(), ENTITY, seen));
  return allowsFileType(fileTypes, file.mimeType)
    ? { file, reason: "" }
    : { file: null, reason: NOT_ALLOWED_TYPE };
}

function toFile(raw: unknown): DriveFile {
  return {
    id: str(raw, "id"),
    name: str(raw, "name"),
    mimeType: str(raw, "mimeType"),
    size: str(raw, "size") || "0",
    modifiedTime: str(raw, "modifiedTime"),
    md5Checksum: str(raw, "md5Checksum"),
    parents: strings(getPath(raw, "parents")),
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** See the note in `gmail.ts`: `String(...)` on a lossless number gives "[object Object]". */
function str(root: unknown, path: string): string {
  return getStringPath(root, path) ?? "";
}

/** The string elements of an array. A non-string parent id is not one we can use. */
function strings(value: unknown): string[] {
  return asArray(value).filter((v): v is string => typeof v === "string");
}
