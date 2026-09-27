/**
 * Google Drive, read-only: one file's metadata, a picked tree walked to its end, and a file's
 * bytes hashed and dropped. Only GETs, and one POST to exchange the refresh token.
 *
 * A TREE IS WHOLE ONLY WHEN EVERY FOLDER'S LISTING ENDED. Shared drives need
 * `supportsAllDrives` and `includeItemsFromAllDrives` on every call, or their files are silently
 * absent. Shortcuts are counted and not followed, as the connector does not follow them.
 *
 * NAMES ARE NOT KEPT. A file is kept as its id, type, size, md5, times and parents, plus the
 * extension its name carries (the type rule needs it); the name a person wrote is dropped as
 * soon as that is read.
 */

import { extensionOf } from "./driveRules.ts";
import {
  type Http,
  type HttpReply,
  type Listing,
  list,
  mapLimit,
  obj,
  str,
  strOrNull,
  walk,
} from "./reads.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FILES = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const FIELDS = "id,name,mimeType,md5Checksum,size,modifiedTime,createdTime,parents";
const RATE_REASONS = /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/u;

/** One Drive file as the reconciliation keeps it: no name, only the extension it carries. */
export interface DriveFile {
  readonly id: string;
  readonly mimeType: string;
  readonly extension: string | null;
  readonly size: string | null;
  readonly md5: string | null;
  readonly modifiedTime: string;
  readonly createdTime: string;
  readonly parents: readonly string[];
  readonly trashed: boolean;
  readonly trashedTime: string | null;
}

export interface DriveTree {
  readonly files: readonly DriveFile[];
  readonly folders: ReadonlySet<string>;
  /** Folder listings that stopped with a page token left, and ids seen on two pages. */
  readonly incomplete: number;
  readonly repeats: number;
  /** Picks Drive would not return. */
  readonly unreadable: readonly string[];
  /** Shortcuts are counted, not followed: the connector does not follow them either. */
  readonly shortcuts: number;
}

/** An authorized-user token file: only the fields a refresh needs. */
export interface Credentials {
  readonly refresh_token: string;
  readonly client_id: string;
  readonly client_secret: string;
}

function toDriveFile(row: Record<string, unknown>): DriveFile {
  return {
    id: str(row.id),
    mimeType: str(row.mimeType),
    extension: extensionOf(str(row.name)),
    size: strOrNull(row.size),
    md5: strOrNull(row.md5Checksum),
    modifiedTime: str(row.modifiedTime),
    createdTime: str(row.createdTime),
    parents: list(row.parents).map(str),
    trashed: row.trashed === true,
    trashedTime: strOrNull(row.trashedTime),
  };
}

/** A tree being walked. */
interface Growing {
  readonly files: Map<string, DriveFile>;
  readonly folders: Set<string>;
  readonly unreadable: string[];
  incomplete: number;
  repeats: number;
  shortcuts: number;
}

/** Fold one folder's listing into the tree; answers the sub-folders to list next. */
function absorb(tree: Growing, folderId: string, listing: Listing<DriveFile> | null): string[] {
  if (listing === null) {
    tree.unreadable.push(folderId);
    return [];
  }
  tree.incomplete += listing.exhausted ? 0 : 1;
  tree.repeats += listing.repeats;
  const next: string[] = [];
  for (const entry of listing.items) {
    if (entry.mimeType === SHORTCUT) {
      tree.shortcuts += 1;
    } else if (entry.mimeType !== FOLDER) {
      tree.files.set(entry.id, entry);
    } else if (!tree.folders.has(entry.id)) {
      tree.folders.add(entry.id);
      next.push(entry.id);
    }
  }
  return next;
}

export class DriveReader {
  readonly #http: Http;
  readonly #credentials: Credentials;
  readonly #retryMs: number;
  #token: string | null = null;

  constructor(http: Http, credentials: Credentials, retryMs = 1000) {
    this.#http = http;
    this.#credentials = credentials;
    this.#retryMs = retryMs;
  }

  /** One file's metadata now; null when Drive answers 404. */
  async file(id: string): Promise<DriveFile | null> {
    const params = new URLSearchParams({
      supportsAllDrives: "true",
      fields: `${FIELDS},trashed,trashedTime`,
    });
    const reply = await this.#get(`${FILES}/${encodeURIComponent(id)}?${params}`);
    return reply === null ? null : toDriveFile(obj(JSON.parse(await reply.text())));
  }

  /** md5 and sha256 of a file's bytes, streamed and dropped; null when Drive answers 404. */
  async digest(id: string): Promise<{ md5: string; sha256: string } | null> {
    const url = `${FILES}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
    const reply = await this.#get(url);
    if (reply === null) {
      return null;
    }
    const md5 = new Bun.CryptoHasher("md5");
    const sha256 = new Bun.CryptoHasher("sha256");
    for await (const chunk of reply.chunks()) {
      md5.update(chunk);
      sha256.update(chunk);
    }
    return { md5: md5.digest("hex"), sha256: sha256.digest("hex") };
  }

  /** Every file under the picks, breadth-first, each folder listed to its last page. */
  async tree(
    picks: readonly { id: string; kind: string }[],
    recurse: boolean,
    concurrency: number,
  ): Promise<DriveTree> {
    const tree: Growing = {
      files: new Map(),
      folders: new Set(picks.filter((pick) => pick.kind === "folder").map((pick) => pick.id)),
      unreadable: [],
      incomplete: 0,
      repeats: 0,
      shortcuts: 0,
    };
    for (const pick of picks.filter((entry) => entry.kind !== "folder")) {
      const file = await this.file(pick.id);
      if (file === null || file.trashed) {
        tree.unreadable.push(pick.id);
      } else {
        tree.files.set(file.id, file);
      }
    }
    let level = [...tree.folders];
    while (level.length > 0) {
      const current = level;
      const listings = await mapLimit(current, concurrency, (id) => this.#children(id));
      const next = listings.flatMap((listing, index) =>
        absorb(tree, current[index] ?? "", listing),
      );
      level = recurse ? next : [];
    }
    return { ...tree, files: [...tree.files.values()] };
  }

  async #children(folderId: string): Promise<Listing<DriveFile> | null> {
    const escaped = folderId.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
    try {
      return await walk(
        async (cursor) => {
          const params = new URLSearchParams({
            q: `'${escaped}' in parents and trashed = false`,
            pageSize: "1000",
            supportsAllDrives: "true",
            includeItemsFromAllDrives: "true",
            fields: `nextPageToken,files(${FIELDS})`,
            ...(cursor === null ? {} : { pageToken: cursor }),
          });
          const reply = await this.#get(`${FILES}?${params}`);
          const body = reply === null ? {} : obj(JSON.parse(await reply.text()));
          return {
            items: list(body.files).map(obj).map(toDriveFile),
            next: strOrNull(body.nextPageToken),
          };
        },
        (file) => file.id,
      );
    } catch {
      return null;
    }
  }

  /** GET with a fresh token once on 401 and back-off on a rate limit; null on 404. */
  async #get(url: string): Promise<HttpReply | null> {
    let refreshed = false;
    for (let attempt = 1; ; attempt += 1) {
      const reply = await this.#http.send(url, {
        method: "GET",
        headers: { authorization: `Bearer ${await this.#access()}` },
      });
      if (reply.status === 200) {
        return reply;
      }
      if (reply.status === 404) {
        return null;
      }
      if (reply.status === 401 && !refreshed) {
        refreshed = true;
        this.#token = null;
        continue;
      }
      const body = await reply.text();
      const retry = reply.status === 429 || reply.status >= 500 || RATE_REASONS.test(body);
      if (!retry || attempt >= 6) {
        // The status only: a body or a query string can echo a file's name.
        throw new Error(`Drive GET ${url.split("?")[0] ?? ""} -> ${reply.status}`);
      }
      await Bun.sleep(this.#retryMs * 2 ** attempt);
    }
  }

  async #access(): Promise<string> {
    if (this.#token !== null) {
      return this.#token;
    }
    const reply = await this.#http.send(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", ...this.#credentials }).toString(),
    });
    const token = reply.status === 200 ? obj(JSON.parse(await reply.text())).access_token : null;
    if (typeof token !== "string") {
      throw new Error(`token refresh -> ${reply.status}`);
    }
    this.#token = token;
    return token;
  }
}
