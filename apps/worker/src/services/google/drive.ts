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
import type { RunJournal } from "../runJournal.ts";
import type { GoogleApi } from "./api.ts";
import { DRIVE_BASE, type DriveFile, ENTITY, listMatchingIn, readOneFile } from "./driveListing.ts";
import type { AlreadyHeld, Harvest, HarvestItem, PickSkipped, RecordProbe } from "./harvest.ts";

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

/**
 * How many listed files one skip-known probe covers.
 *
 * The listing streams, so nothing here holds the tree; this is only how many files are
 * gathered before one round trip asks which of them we already hold. Small enough that the
 * hold is noise against a 1 GiB budget, large enough that a folder of ten thousand files
 * costs fifty statements rather than ten thousand.
 */
const PROBE_BATCH = 200;

export function driveBaseUrl(): string {
  return DRIVE_BASE;
}

/**
 * Harvest what the admin picked, one file at a time.
 *
 * **A FILE WE ALREADY HOLD UNCHANGED IS NOT READ AGAIN**, and the comparison that decides
 * that is Postgres's rather than this module's: `modifiedTime` goes into the probe as the
 * text Drive sent and `raw.records.source_updated_at` is parsed beside it, because the two
 * spellings of one instant are not equal as strings and a JavaScript compare would re-read
 * the whole of a customer's Drive on every run while looking like it was skipping.
 *
 * Unchanged is necessary and was briefly mistaken for sufficient. A file whose record landed
 * under the old order -- record first, bytes last -- has an unmoved `modifiedTime` and no
 * document, so it matched the probe and was skipped forever with nothing in the lake. Drive
 * carried the same exposure as Gmail here and for the same reason; the probe now also requires
 * the row to be marked harvest-complete. ADR 0035. Note the asymmetry with Gmail: every Drive
 * file IS a document, so a mark of zero means an oversized file whose record is legitimately
 * alone -- which is why the mark is a count of what LANDED and not a comparison against what
 * the pick matched, or such a file would be downloaded again every run for ever.
 *
 * **A SKIPPED FILE STILL ENTERS `seenIds`**, which is the quiet half and the dangerous one.
 * `tombstoneMissing` negates the kept-id set, so a file left out of it because it had not
 * changed is reported DELETED -- and in a steady-state Drive that is every file in it, on
 * the second run. A file the listing named was seen; whether we re-read it is a different
 * question from whether it exists.
 *
 * A file whose listing carries no `modifiedTime` is left out of the probe entirely rather
 * than probed on presence alone. There is no evidence it is unchanged, and no evidence is
 * not "unchanged" -- so it is read again, which costs a download and cannot lose an edit.
 */
export async function* harvestDrive(
  api: GoogleApi,
  scope: DriveScope,
  journal: RunJournal,
  held: AlreadyHeld,
): Harvest {
  const seen = new Set<string>();
  const skipped: PickSkipped[] = [];
  let folders = 0;
  // Folders WALKED, which is not `HarvestSummary.listed` (files named). The journal's
  // `listed` is this one, and it is what `picks_listed` compares against `folders` to say
  // how far a recursive descent went.
  let walked = 0;
  let known = 0;

  for (const picked of scope.files) {
    if (picked.kind === "folder") {
      folders += 1;
    }
    const files = filesOfPick(api, picked, {
      fileTypes: scope.fileTypes,
      recurse: scope.recurse,
      seen: seen.size,
      skipped,
    });

    const into: Taking = { api, picked, seen, held };
    const batch: DriveFile[] = [];
    let step = await files.next();
    while (!step.done) {
      batch.push(step.value);
      if (batch.length >= PROBE_BATCH) {
        known += yield* take(batch.splice(0), into);
      }
      step = await files.next();
    }
    known += yield* take(batch.splice(0), into);
    walked += step.value;
  }

  // The sentence a green run landing nothing could not say before: what was looked in, what
  // was found there, and the descent that explains the difference between them. `listed`
  // exceeds `folders` exactly when a recursive walk found sub-folders, which is how the run
  // says how far down it went rather than leaving the reader to infer it from the count.
  // `matched` is still every distinct file the picks yielded, skipped ones included -- it
  // answers "did the pick find anything", which is not "did we have to read it".
  journal.info("picks_listed", {
    entity: ENTITY,
    folders,
    listed: walked,
    picks: scope.files.length,
    matched: seen.size,
    skipped: skipped.length,
  });

  return { seenIds: [...seen], skipped, listed: seen.size, known };
}

/** What one pick's batches are taken against: it outlives them, so it is not per batch. */
interface Taking {
  readonly api: GoogleApi;
  readonly picked: DriveScope["files"][number];
  /** Every file id this whole harvest has met. Mutated here; see {@link take}. */
  readonly seen: Set<string>;
  readonly held: AlreadyHeld;
}

/**
 * One batch of listed files, turned into what to harvest. Answers how many it skipped.
 *
 * Every file here enters `seen` before anything decides whether to read it, which is the
 * tombstone rule spelled out in `harvestDrive`'s docstring. De-duplication comes first: one
 * file picked twice, or sitting in two picked folders, is one file.
 */
async function* take(
  batch: readonly DriveFile[],
  into: Taking,
): AsyncGenerator<HarvestItem, number> {
  const { api, picked, seen, held } = into;
  const fresh: DriveFile[] = [];
  for (const file of batch) {
    if (!seen.has(file.id)) {
      seen.add(file.id);
      fresh.push(file);
    }
  }

  const probes: RecordProbe[] = fresh.flatMap((file) =>
    file.modifiedTime === ""
      ? []
      : [{ sourceRecordId: file.id, sourceUpdatedAt: file.modifiedTime }],
  );
  const unchanged = await held(probes);

  let skippedHere = 0;
  for (const file of fresh) {
    if (unchanged.has(file.id)) {
      skippedHere += 1;
      continue;
    }
    yield { record: toRecord(file), documents: [toDocument(api, file, picked, seen.size)] };
  }
  return skippedHere;
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
 * single file itself. Answers how many folders were listed to produce them.
 *
 * A pick that yields nothing because it is outside the allow-list is appended to `skipped`
 * rather than yielded empty, so the caller can refuse it with a reason instead of landing a
 * silent zero. The refusal is recorded against the PICK, not against each folder walked: an
 * admin picked one thing and is owed one sentence about it, and a tree of empty sub-folders
 * would otherwise refuse once per branch.
 *
 * Streaming does not move that. The count it turns on is what this generator YIELDED, so it
 * is only known at the end of the pick -- which is exactly where the refusal is pushed, one
 * per pick, before the next pick starts. What it counts is the listing, not the landing: a
 * folder whose only file was already seen through another pick still matched something.
 */
async function* filesOfPick(
  api: GoogleApi,
  picked: DriveScope["files"][number],
  options: {
    fileTypes: readonly string[];
    recurse: boolean;
    seen: number;
    skipped: PickSkipped[];
  },
): AsyncGenerator<DriveFile, number> {
  const { fileTypes, recurse, seen, skipped } = options;

  if (picked.kind !== "folder") {
    const one = await readOneFile(api, picked.id, fileTypes, seen);
    if (one.file === null) {
      skipped.push({ fileId: picked.id, reason: one.reason });
      return 0;
    }
    yield one.file;
    return 0;
  }

  let matched = 0;
  const files = listMatchingIn(api, picked.id, { fileTypes, recurse, seen });
  let step = await files.next();
  while (!step.done) {
    matched += 1;
    yield step.value;
    step = await files.next();
  }
  if (matched === 0) {
    skipped.push({ fileId: picked.id, reason: NOTHING_MATCHED });
  }
  return step.value;
}
