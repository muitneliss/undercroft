/**
 * What a Drive scope can be chosen from: the folders a grant can see, and the file types in it.
 *
 * The browse half of Drive, and only possible since ADR 0047 moved the grant to
 * `drive.readonly` -- under `drive.file` a server-side listing saw nothing that had not been
 * picked, so there was nothing to list. It answers the two questions an admin choosing a Drive
 * scope has, which Google's Picker answers only for the first and only in a browser: WHERE
 * (each folder, with the path that tells two "2026" folders apart) and WHAT (which MIME types
 * are actually present, so `fileTypes` can be widened past the preset from inside the product
 * rather than by already knowing the answer, issue 177).
 *
 * **Bounded, and says so.** A drive can hold millions of files, and a browse is a request an
 * admin is waiting on behind a control plane that gives up after thirty seconds. So each listing
 * reads at most a fixed number of pages, and one that stops with pages left -- or that Google
 * itself reports as incomplete, which `corpora=allDrives` is allowed to do -- is named in
 * `partial`. A list cut at its bound is never presented as the whole: "these are the types in
 * your drive" is a claim an admin acts on. CLAUDE.md rule 2.
 *
 * Every request goes through the `GoogleApi` it is handed, so the pacer and retry policy that
 * govern a harvest govern this too.
 */

import type { BrowseScopeResponse } from "@undercroft/contracts";
import { getPath, getStringPath } from "@undercroft/core";

import type { GoogleApi } from "./api.ts";
import { acrossAllDrives, DRIVE_BASE, FOLDER_MIME } from "./driveListing.ts";

export const SHARED_DRIVES_URL = "https://www.googleapis.com/drive/v3/drives";

/** The most a listing asks for in one page; Drive's own maximum for `files.list`. */
const FILES_PAGE = "1000";
/** Drive's maximum for `drives.list`. */
const DRIVES_PAGE = "100";

/**
 * How many pages each listing may read before it stops and says it stopped.
 *
 * Eleven requests at worst -- five thousand folders, five thousand files' types, a hundred
 * shared drives -- which at the pacer's three a second leaves room inside the control plane's
 * thirty-second wait for Google's own latency. A drive past these bounds still browses; it
 * browses partially and is told so.
 */
export interface DriveBrowseBounds {
  readonly sharedDrivePages: number;
  readonly folderPages: number;
  readonly typePages: number;
}

export const DRIVE_BROWSE_BOUNDS: DriveBrowseBounds = {
  sharedDrivePages: 1,
  folderPages: 5,
  typePages: 5,
};

type Item = BrowseScopeResponse["items"][number];
type Bounded = BrowseScopeResponse["partial"][number];

export interface DriveChoices {
  readonly items: Item[];
  readonly partial: Bounded[];
}

/** One folder as the listing reports it: its name and the folder (or drive) it sits in. */
interface Folder {
  readonly name: string;
  readonly parent: string;
}

/**
 * Every folder the grant can see, each with its path, then every file type present.
 *
 * Folders first, because they are what a scope is made of; types second. Both sorted, so two
 * browses of an unchanged drive read the same -- Drive's own order is not promised.
 */
export async function listDriveChoices(
  api: GoogleApi,
  bounds: DriveBrowseBounds = DRIVE_BROWSE_BOUNDS,
): Promise<DriveChoices> {
  const drives = await readPages(api, sharedDrivesUrl(), "drives", bounds.sharedDrivePages);
  const folders = await readPages(
    api,
    filesUrl(`mimeType = '${FOLDER_MIME}' and trashed = false`, "files(id,name,parents)"),
    "folders",
    bounds.folderPages,
  );
  const types = await readPages(
    api,
    filesUrl(`mimeType != '${FOLDER_MIME}' and trashed = false`, "files(mimeType)"),
    "files",
    bounds.typePages,
  );

  const partial: Bounded[] = [];
  // A cut drive list leaves some paths without the shared drive that should lead them, so it
  // is the folder list it makes incomplete.
  if (drives.cut || folders.cut) {
    partial.push("folder");
  }
  if (types.cut) {
    partial.push("file-type");
  }

  return {
    items: [...folderItems(drives.pages, folders.pages), ...typeItems(types.pages)],
    partial,
  };
}

/** The folders, each with its path, ordered by that path. */
function folderItems(drivePages: readonly unknown[], folderPages: readonly unknown[]): Item[] {
  const driveNames = new Map<string, string>();
  for (const drive of drivePages.flatMap((page) => entries(page, "drives"))) {
    driveNames.set(str(drive, "id"), str(drive, "name"));
  }
  const folders = new Map<string, Folder>();
  for (const folder of folderPages.flatMap((page) => entries(page, "files"))) {
    // A folder with no id cannot be picked; offering one would be offering a guess.
    if (str(folder, "id") === "") {
      continue;
    }
    folders.set(str(folder, "id"), {
      name: str(folder, "name"),
      // Drive gives a file one parent now; the first is the one it has.
      parent: str(getPath(folder, "parents"), "0"),
    });
  }

  return [...folders.entries()]
    .map(([id, folder]) => ({
      id,
      name: folder.name,
      kind: "folder" as const,
      path: pathOf(id, folders, driveNames),
    }))
    .toSorted((a, b) => comparePaths(a.path, b.path));
}

/**
 * Segment by segment, so a folder sorts directly under its parent. Joining the segments with a
 * separator first would let collation, which ignores control characters, compare across them.
 */
function comparePaths(a: readonly string[], b: readonly string[]): number {
  for (let at = 0; at < Math.min(a.length, b.length); at += 1) {
    const order = (a[at] ?? "").localeCompare(b[at] ?? "");
    if (order !== 0) {
      return order;
    }
  }
  return a.length - b.length;
}

/**
 * A folder's path, outermost first, ending with its own name.
 *
 * It climbs while the parent is a folder this listing saw, then names the shared drive it
 * reached if it reached one. A parent it did not see -- My Drive's root, or the folder above
 * one somebody shared with this account -- ends the climb there, so the path is as far up as
 * the grant can see and claims nothing beyond it. `seen` stops a cycle, which Drive does not
 * promise cannot happen.
 */
function pathOf(
  id: string,
  folders: ReadonlyMap<string, Folder>,
  driveNames: ReadonlyMap<string, string>,
): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let at = id;
  let folder = folders.get(at);
  while (folder !== undefined && !seen.has(at)) {
    seen.add(at);
    path.unshift(folder.name);
    at = folder.parent;
    folder = folders.get(at);
  }
  const drive = driveNames.get(at);
  if (drive !== undefined) {
    path.unshift(drive);
  }
  return path;
}

/** Each distinct MIME type once, sorted. Its id IS what `fileTypes` records. */
function typeItems(typePages: readonly unknown[]): Item[] {
  const types = new Set(
    typePages.flatMap((page) => entries(page, "files")).map((file) => str(file, "mimeType")),
  );
  types.delete("");
  return [...types]
    .toSorted((a, b) => a.localeCompare(b))
    .map((type) => ({ id: type, name: type, kind: "file-type" as const }));
}

/**
 * Up to `maxPages` pages of one listing, and whether it was cut short.
 *
 * Cut means there was a next page this did not read, or Google said the search behind a page
 * was incomplete. Either way the pages here are not the whole answer.
 */
async function readPages(
  api: GoogleApi,
  base: URL,
  entity: string,
  maxPages: number,
): Promise<{ pages: unknown[]; cut: boolean }> {
  const pages: unknown[] = [];
  let cut = false;
  let pageToken = "";
  for (let read = 0; read < maxPages; read += 1) {
    const url = new URL(base);
    if (pageToken !== "") {
      url.searchParams.set("pageToken", pageToken);
    }
    const page = await api.getJson(url.toString(), entity);
    pages.push(page);
    if (getPath(page, "incompleteSearch") === true) {
      cut = true;
    }
    pageToken = str(page, "nextPageToken");
    if (pageToken === "") {
      return { pages, cut };
    }
  }
  return { pages, cut: true };
}

/**
 * A `files.list` across every drive the account can reach.
 *
 * `corpora=allDrives` with both all-drives flags, because a folder in a shared drive is
 * otherwise missing from the answer -- and missing reads as "there is no such folder".
 */
function filesUrl(q: string, files: string): URL {
  const url = new URL(DRIVE_BASE);
  url.searchParams.set("q", q);
  url.searchParams.set("fields", `nextPageToken,incompleteSearch,${files}`);
  url.searchParams.set("pageSize", FILES_PAGE);
  url.searchParams.set("corpora", "allDrives");
  acrossAllDrives(url);
  return url;
}

/** The shared drives the account belongs to, for the name that leads their folders' paths. */
function sharedDrivesUrl(): URL {
  const url = new URL(SHARED_DRIVES_URL);
  url.searchParams.set("pageSize", DRIVES_PAGE);
  url.searchParams.set("fields", "nextPageToken,drives(id,name)");
  return url;
}

function entries(page: unknown, key: string): unknown[] {
  const value = getPath(page, key);
  return Array.isArray(value) ? value : [];
}

/** See the note in `gmail.ts`: `String(...)` on a lossless number gives "[object Object]". */
function str(root: unknown, path: string): string {
  return getStringPath(root, path) ?? "";
}
