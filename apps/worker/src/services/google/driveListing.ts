/**
 * Asking Google Drive what is in a folder.
 *
 * Split out of `drive.ts` when descent became the admin's choice (ADR 0031) and one file held
 * two jobs: deciding what to LAND, and knowing how Drive is ASKED. This is the second. What it
 * hides from the harvester is Drive's query dialect, the paging that dialect answers in, and
 * the fact that a listing hands back containers alongside files -- none of which the harvester
 * has any business knowing to turn a file into a record.
 *
 * **A folder is a container, never a document.** A listing returns sub-folders -- always when
 * `fileTypes` is empty, and by construction when recursing, because the folder type joins the
 * query. One landed as a document is a zero-byte file whose whole content is its name, so they
 * leave here as a separate list of places to look next, never mixed into the files.
 *
 * **Whether Google will answer a NESTED listing is not settled here.** A picked folder's direct
 * children are demonstrably readable under `drive.file`; whether that cascades to a sub-folder
 * is not something Google's documentation states either way. It is deliberately not guessed at:
 * a refusal raises through `api.getJson` as a `ConnectorError` carrying the reason and how many
 * records were seen, so the first run says so plainly. Swallowing it as a skip would land a
 * subset of a customer's folder and call the run green.
 */

import { allowsFileType } from "@undercroft/contracts";
import { getPath, getStringPath } from "@undercroft/core";

import type { GoogleApi } from "./api.ts";

export const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";
export const ENTITY = "files";
/** Drive's own type for a folder. */
const FOLDER_MIME = "application/vnd.google-apps.folder";
const PAGE_SIZE = "100";
const FIELDS = "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,parents)";
const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,md5Checksum,parents";

/** Why a pick was not taken: the file's type is outside the chosen allow-list. */
export const NOT_ALLOWED_TYPE = "not-an-allowed-type";

export interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: string;
  readonly modifiedTime: string;
  readonly md5Checksum: string;
  readonly parents: string[];
}

/** What a folder yielded, and how many folders had to be listed to yield it. */
export interface FolderListing {
  readonly files: DriveFile[];
  readonly listed: number;
}

/**
 * Every matching file under a picked folder, to the depth the admin chose.
 *
 * `visited` is what keeps the walk finite: a shortcut, or the same folder reachable down two
 * branches, would otherwise be listed forever. It holds folder ids rather than file ids --
 * duplicate FILES are a caller concern, and `harvestDrive` already de-duplicates them.
 */
export async function listMatchingIn(
  api: GoogleApi,
  rootId: string,
  options: { fileTypes: readonly string[]; recurse: boolean; seen: number },
): Promise<FolderListing> {
  const { fileTypes, recurse, seen } = options;
  const files: DriveFile[] = [];
  const visited = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  const typeClause = mimeTypeClause(listingTypes(fileTypes, recurse));
  let listed = 0;

  // A sub-folder pushed below is walked by this same loop: `for...of` reads the array live,
  // so the queue grows under the iterator rather than needing a second pass over it.
  for (const folderId of queue) {
    listed += 1;
    const found = await listOneFolder(api, queryFor(folderId, typeClause), seen);
    files.push(...found.files);

    if (!recurse) {
      continue;
    }
    for (const childId of found.folders) {
      if (!visited.has(childId)) {
        visited.add(childId);
        queue.push(childId);
      }
    }
  }

  return { files, listed };
}

/**
 * A directly picked file, or the reason it is not one we may take.
 *
 * A file outside the allow-list is refused: the consent says which types may be read. The
 * refusal is RETURNED rather than swallowed so the caller can record it -- an admin who
 * picked a spreadsheet nobody allowed is owed the sentence "that pick is not an allowed type"
 * and not a run that quietly landed nothing.
 */
export async function readOneFile(
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

/** One folder's contents, every page of them, split into what to land and where to look next. */
async function listOneFolder(
  api: GoogleApi,
  q: string,
  seen: number,
): Promise<{ files: DriveFile[]; folders: string[] }> {
  const files: DriveFile[] = [];
  const folders: string[] = [];
  let pageToken: string | null = null;

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
      const file = toFile(raw);
      if (file.mimeType === FOLDER_MIME) {
        folders.push(file.id);
      } else {
        files.push(file);
      }
    }
    const next = str(page, "nextPageToken");
    pageToken = next === "" ? null : next;
  } while (pageToken !== null);

  return { files, folders };
}

/** One folder's `q=`, with the type clause the whole walk shares. */
function queryFor(folderId: string, typeClause: string): string {
  return typeClause === ""
    ? `'${folderId}' in parents and trashed=false`
    : `'${folderId}' in parents and ${typeClause} and trashed=false`;
}

/**
 * Which types a folder LISTING asks for, which is not quite the allow-list.
 *
 * Empty stays empty: "every type" already includes folders, and adding the folder type to an
 * empty list would turn "everything" into "folders only" -- a filter that lands nothing while
 * looking like it widened something. A recursive walk otherwise adds the folder type, so one
 * request per page yields both the files to land and the folders to descend into.
 */
function listingTypes(fileTypes: readonly string[], recurse: boolean): string[] {
  if (fileTypes.length === 0) {
    return [];
  }
  return recurse ? [...fileTypes, FOLDER_MIME] : [...fileTypes];
}

/**
 * A value for Drive's query syntax, escaped.
 *
 * The folder id needs none of this -- it is Google-issued and opaque, and `'` is not in its
 * alphabet -- but a file type can come from the free-text field an admin typed into, and that
 * IS ordinary text.
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
