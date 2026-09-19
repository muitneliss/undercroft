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

// biome-ignore-all lint/performance/noAwaitInLoops: These sequential awaits are the point. Pacing a connector against a rate limit, walking Dokploy deployment records until one settles, and migrating SQL files in order all require the previous iteration to finish first; running them concurrently is the bug this rule would introduce.
// biome-ignore-all lint/security/noSecrets: False positives. The rule flags high-entropy string literals, and these are test fixtures with invented values (per .claude/rules/pii.md, fixtures are invented rather than anonymised), plus base64url sample tokens and SQL role names. No real credential is in any tracked file; CI enforces that separately.
// biome-ignore-all lint/style/noContinue: Each `continue` here skips one item in a loop with a stated reason on the line above. Restructuring to avoid it means nesting the body in an `if`, which adds a level of indentation and says nothing new.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

import { canonicalJson, getPath, getStringPath } from "@undercroft/core";
import type { DriveScope } from "@undercroft/contracts";

import type { DocumentToLand } from "../landDocument.ts";
import type { RecordToLand } from "../land.ts";
import { type RunJournal, SILENT_JOURNAL } from "../runJournal.ts";
import type { GoogleApi } from "./api.ts";

/** Why a pick was not taken. The one reason this collector has, and it is a refusal. */
export const NOT_A_PDF = "not-a-pdf";

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
  /**
   * What was picked and not taken, with why.
   *
   * A directly-picked file that is not a PDF used to be dropped where it was found, which
   * made "we were given nothing" and "we refused what we were given" the same green run
   * landing 0. CLAUDE.md rule 2: recorded with its reason, never dropped.
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
    const files = await pdfsOf(api, picked, records.length, skipped);

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
    pdfs: records.length,
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
    contentType: PDF,
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
 * The PDFs one pick yields: a folder's, listed one level down, or the single file itself.
 *
 * A pick that yields nothing because it is not a PDF is appended to `skipped` rather than
 * returned empty, so the caller can refuse it with a reason instead of landing a silent zero.
 */
async function pdfsOf(
  api: GoogleApi,
  picked: DriveScope["files"][number],
  seen: number,
  skipped: DriveHarvest["skipped"],
): Promise<DriveFile[]> {
  if (picked.kind === "folder") {
    return listPdfsIn(api, picked.id, seen);
  }
  const one = await readOneFile(api, picked.id, seen);
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

/**
 * A directly picked file, or the reason it is not one we may take.
 *
 * Non-PDFs are refused: the consent says PDFs. The refusal is RETURNED rather than swallowed
 * so the caller can record it -- an admin who picked a spreadsheet is owed the sentence
 * "that pick is not a PDF" and not a run that quietly landed nothing.
 */
async function readOneFile(
  api: GoogleApi,
  fileId: string,
  seen: number,
): Promise<{ file: DriveFile | null; reason: string }> {
  const url = new URL(`${DRIVE_BASE}/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", FILE_FIELDS);
  url.searchParams.set("supportsAllDrives", "true");

  const file = toFile(await api.getJson(url.toString(), ENTITY, seen));
  return file.mimeType === PDF ? { file, reason: "" } : { file: null, reason: NOT_A_PDF };
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
