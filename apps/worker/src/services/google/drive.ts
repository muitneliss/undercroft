/**
 * Google Drive: PDFs from what the admin picked, into the lake.
 *
 * The scope is `drive.file`, not `drive.readonly`, and that is a security decision rather
 * than a preference. `drive.file` grants access only to items the user chose through the
 * Google Picker, so "PDFs inside the folders you select. No other folder is read" -- copy
 * this product already ships -- is enforced by Google rather than by our own `q=` filter.
 * It is also not a Google "restricted" scope, so it needs no annual CASA assessment.
 *
 * A consequence worth stating: a listing here cannot see anything that was not picked, so a
 * wrong filter fails closed. The filter is still written narrowly, because failing closed is
 * a backstop and not an excuse.
 *
 * **Descent is one level.** A folder's children are listed; a child folder's children are
 * not. Recursive descent through a shared drive can reach folders the admin never saw in
 * the Picker, which would make the printed promise false even where Google would allow the
 * read.
 */

import { canonicalJson, getPath, getStringPath } from "@undercroft/core";
import type { DriveScope } from "@undercroft/contracts";

import type { DocumentToLand } from "../landDocument.ts";
import type { RecordToLand } from "../land.ts";
import type { GoogleApi } from "./api.ts";

const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";
const PDF = "application/pdf";
const ENTITY = "files";
const PAGE_SIZE = "100";
const FIELDS = "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,parents)";
const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,md5Checksum,parents";

export interface DriveHarvest {
  readonly records: RecordToLand[];
  readonly documents: DocumentToLand[];
  /** Every document id this run saw, so the caller can tombstone what vanished. */
  readonly seenIds: string[];
}

export function driveBaseUrl(): string {
  return DRIVE_BASE;
}

export async function harvestDrive(api: GoogleApi, scope: DriveScope): Promise<DriveHarvest> {
  const records: RecordToLand[] = [];
  const documents: DocumentToLand[] = [];
  const seen = new Set<string>();

  for (const picked of scope.files) {
    const files =
      picked.kind === "folder"
        ? await listPdfsIn(api, picked.id, records.length)
        : await readOneFile(api, picked.id, records.length);

    for (const file of files) {
      if (seen.has(file.id)) {
        continue; // One file picked twice, or in two picked folders.
      }
      seen.add(file.id);

      records.push({
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
      });

      documents.push({
        documentId: file.id,
        contentType: PDF,
        declaredBytes: file.size,
        // Reaches dbt: ids, types, counts. `parents` are folder ids, not folder names.
        metadata: {
          mimeType: file.mimeType,
          parents: file.parents,
          pickedVia: picked.kind,
        },
        // Reaches the lake manifest only: everything a person named.
        manifest: {
          filename: file.name,
          pickedFrom: picked.name,
          fileId: file.id,
        },
        sourceUpdatedAt: file.modifiedTime === "" ? null : file.modifiedTime,
        fetchBytes: () =>
          api.getBytes(
            `${DRIVE_BASE}/${encodeURIComponent(file.id)}?alt=media`,
            ENTITY,
            records.length,
          ),
      });
    }
  }

  return { records, documents, seenIds: [...seen] };
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

async function listPdfsIn(api: GoogleApi, folderId: string, seen: number): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | null = null;

  do {
    const url = new URL(DRIVE_BASE);
    // Single quotes around the id are Drive's query syntax, not string building: the id is
    // Google-issued and opaque, and `'` is not in its alphabet.
    url.searchParams.set("q", `'${folderId}' in parents and mimeType='${PDF}' and trashed=false`);
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

/** A directly picked file. Non-PDFs are skipped: the consent says PDFs. */
async function readOneFile(api: GoogleApi, fileId: string, seen: number): Promise<DriveFile[]> {
  const url = new URL(`${DRIVE_BASE}/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", FILE_FIELDS);
  url.searchParams.set("supportsAllDrives", "true");

  const file = toFile(await api.getJson(url.toString(), ENTITY, seen));
  return file.mimeType === PDF ? [file] : [];
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
