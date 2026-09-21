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
 * **How deep descent goes is the admin's recorded choice.** `scope.recurse` false -- which is
 * what every selection saved before that field existed means -- lists a folder's children and
 * stops; true walks the whole tree beneath it. Descent used to be one level ALWAYS, on the
 * reasoning that a recursive walk can reach folders the admin never saw in the Picker and so
 * would make the printed promise false. That reasoning was right about the hazard and wrong
 * about the remedy: it is answered by the admin saying which they want, and reading that back
 * on the card, rather than by the deeper read being impossible. ADR 0031.
 *
 * **Which types are allowed is a second, independent filter**, on top of folder-boundedness:
 * `scope.fileTypes` (empty means every type, the same recorded-decision idiom as an empty
 * label or entity list -- `@undercroft/contracts`). A folder listing asks Google's `q=` for
 * only the allowed types; a directly-picked single file is checked after the fact, because
 * there is nothing to filter a lookup of one specific id by.
 *
 * How Drive is ASKED any of this -- the query dialect, the paging, the fact that a listing
 * hands back containers alongside files -- is `driveListing.ts`. What lands is here.
 */

import type { DriveScope } from "@undercroft/contracts";
import { canonicalJson } from "@undercroft/core";

import type { DocumentToLand } from "../landDocument.ts";
import type { RecordToLand } from "../land.ts";
import { type RunJournal, SILENT_JOURNAL } from "../runJournal.ts";
import type { GoogleApi } from "./api.ts";
import {
  DRIVE_BASE,
  type DriveFile,
  ENTITY,
  type FolderListing,
  listMatchingIn,
  readOneFile,
} from "./driveListing.ts";

/**
 * Why a picked FOLDER yielded nothing.
 *
 * Not an error -- an empty folder is a legitimate answer -- but it must be SAID. Without it,
 * "the folder is empty", "everything in it is outside the allow-list" and "the pick no longer
 * resolves" are one green run landing 0 with no refusals, which is the shape of the report
 * "Drive syncs nothing even though I have data". A directly-picked file already refused with
 * a reason; this is the folder half of the same rule. CLAUDE.md rule 2.
 */
export const NOTHING_MATCHED = "no-matching-files-in-folder";

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
   *
   * BOTH kinds of pick report here now. The file half was closed first; a folder that listed
   * nothing stayed silent for longer, and it is the commoner half, because a folder is what
   * an admin usually picks and an allow-list is what usually empties it.
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
  let listed = 0;

  for (const picked of scope.files) {
    if (picked.kind === "folder") {
      folders += 1;
    }
    const yielded = await matchingFilesOf(api, picked, {
      fileTypes: scope.fileTypes,
      recurse: scope.recurse,
      seen: records.length,
      skipped,
    });
    listed += yielded.listed;

    for (const file of yielded.files) {
      if (seen.has(file.id)) {
        continue; // One file picked twice, or in two picked folders.
      }
      seen.add(file.id);

      records.push(toRecord(file));
      documents.push(toDocument(api, file, picked, records.length));
    }
  }

  // The sentence a green run landing nothing could not say before: what was looked in, what
  // was found there, and the descent that explains the difference between them. `listed`
  // exceeds `folders` exactly when a recursive walk found sub-folders, which is how the run
  // says how far down it went rather than leaving the reader to infer it from the count.
  journal.info("picks_listed", {
    entity: ENTITY,
    folders,
    listed,
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
 * The matching files one pick yields: a folder's tree, to the depth the admin chose, or the
 * single file itself.
 *
 * A pick that yields nothing because it is outside the allow-list is appended to `skipped`
 * rather than returned empty, so the caller can refuse it with a reason instead of landing a
 * silent zero. The refusal is recorded against the PICK, not against each folder walked: an
 * admin picked one thing and is owed one sentence about it, and a tree of empty sub-folders
 * would otherwise refuse once per branch.
 */
async function matchingFilesOf(
  api: GoogleApi,
  picked: DriveScope["files"][number],
  options: {
    fileTypes: readonly string[];
    recurse: boolean;
    seen: number;
    skipped: DriveHarvest["skipped"];
  },
): Promise<FolderListing> {
  const { fileTypes, recurse, seen, skipped } = options;
  if (picked.kind === "folder") {
    const yielded = await listMatchingIn(api, picked.id, { fileTypes, recurse, seen });
    if (yielded.files.length === 0) {
      skipped.push({ fileId: picked.id, reason: NOTHING_MATCHED });
    }
    return yielded;
  }
  const one = await readOneFile(api, picked.id, fileTypes, seen);
  if (one.file === null) {
    skipped.push({ fileId: picked.id, reason: one.reason });
    return { files: [], listed: 0 };
  }
  return { files: [one.file], listed: 0 };
}
