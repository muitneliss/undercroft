/**
 * Google Drive, read-only: one file's metadata, and a folder's whole tree.
 *
 * A TREE IS COMPLETE ONLY WHEN EVERY FOLDER'S LISTING ENDED. `tree` walks breadth-first and
 * records any folder whose listing stopped with a page token left; the suite treats such a
 * tree as incomplete rather than comparing half of it. Shared drives need
 * `supportsAllDrives` and `includeItemsFromAllDrives` on every call, or their files are
 * silently absent. Shortcuts are counted and not followed: a shortcut points outside the
 * folder, and following it would compare files neither warehouse was asked to read.
 */

import type { GoogleApi } from "./google.ts";
import { arrayOrEmpty, asObject, objectOrEmpty, stringOrNull, text } from "./json.ts";
import { walkPages } from "./paginate.ts";

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const RUNAWAY_PAGES = 2000;
const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const LIST_FIELDS =
  "nextPageToken,files(id,name,mimeType,md5Checksum,size,modifiedTime,parents,driveId)";
const FILE_FIELDS = "id,name,mimeType,md5Checksum,size,modifiedTime,parents,driveId,trashed";

export interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly md5Checksum: string | null;
  readonly size: string | null;
  readonly modifiedTime: string;
  readonly parents: readonly string[];
  readonly driveId: string | null;
  /** Slash-joined names from the listing root down to the file, root excluded. */
  readonly path: string;
  readonly depth: number;
}

export interface DriveTree {
  readonly files: readonly DriveFile[];
  readonly folders: readonly DriveFile[];
  /** Folders whose listing did not reach its end; any of these makes the tree incomplete. */
  readonly incomplete: readonly string[];
  readonly shortcuts: number;
}

interface Pending {
  readonly id: string;
  readonly path: string;
  readonly depth: number;
}

export class DriveClient {
  readonly #api: GoogleApi;

  constructor(api: GoogleApi) {
    this.#api = api;
  }

  async file(id: string): Promise<DriveFile | null> {
    const params = new URLSearchParams({ supportsAllDrives: "true", fields: FILE_FIELDS });
    const body = await this.#api.get(`${DRIVE}/${encodeURIComponent(id)}?${params}`, true);
    return body === null ? null : toDriveFile(body, "", 0);
  }

  async tree(rootId: string): Promise<DriveTree> {
    const files: DriveFile[] = [];
    const folders: DriveFile[] = [];
    const incomplete: string[] = [];
    let shortcuts = 0;
    const queue: Pending[] = [{ id: rootId, path: "", depth: 0 }];
    const seen = new Set<string>([rootId]);
    for (let folder = queue.shift(); folder !== undefined; folder = queue.shift()) {
      const listing = await this.#children(folder);
      if (!listing.complete) {
        incomplete.push(folder.id);
      }
      for (const entry of listing.entries) {
        if (entry.mimeType === SHORTCUT) {
          shortcuts += 1;
        } else if (entry.mimeType !== FOLDER) {
          files.push(entry);
        } else if (!seen.has(entry.id)) {
          folders.push(entry);
          seen.add(entry.id);
          queue.push({ id: entry.id, path: entry.path, depth: entry.depth });
        }
      }
    }
    return { files, folders, incomplete, shortcuts };
  }

  async #children(folder: Pending): Promise<{ entries: DriveFile[]; complete: boolean }> {
    const walk = await walkPages(
      async (cursor) => {
        const params = new URLSearchParams({
          q: `'${folder.id}' in parents and trashed = false`,
          pageSize: "1000",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
          fields: LIST_FIELDS,
        });
        if (cursor !== null) {
          params.set("pageToken", cursor);
        }
        const body = objectOrEmpty(await this.#api.get(`${DRIVE}?${params}`));
        return {
          items: arrayOrEmpty(body.files).map(asObject),
          next: stringOrNull(body.nextPageToken),
        };
      },
      { maxPages: RUNAWAY_PAGES, idOf: (item) => text(item.id) },
    );
    const entries = walk.items.map((item) => {
      const name = text(item.name);
      const path = folder.path.length === 0 ? name : `${folder.path}/${name}`;
      return toDriveFile(item, path, folder.depth + 1);
    });
    return { entries, complete: walk.exhausted };
  }
}

function toDriveFile(item: Record<string, unknown>, path: string, depth: number): DriveFile {
  return {
    id: text(item.id),
    name: text(item.name),
    mimeType: text(item.mimeType),
    md5Checksum: stringOrNull(item.md5Checksum),
    size: stringOrNull(item.size),
    modifiedTime: text(item.modifiedTime),
    parents: arrayOrEmpty(item.parents).map(text),
    driveId: stringOrNull(item.driveId),
    path,
    depth,
  };
}
