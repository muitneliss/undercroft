/**
 * What a Drive walk lands as RECORDS, and whether landing one again would change anything.
 *
 * Split out of `drive.ts` when a walk began landing two streams (ADR 0078): `files`, Drive's
 * own facts about each file, and `folders`, the tree those files sit in. `drive.ts` decides
 * what to read and what to download; this module knows what each record says and how to tell
 * that it has not changed.
 *
 * **A record lands again only when its bytes differ from the ones held.** The collector hashes
 * the record it would land, exactly as `landRecords` would store it, and compares with the
 * digest the projection copied from the lake. That is one statement per batch, where letting
 * the lake decide costs an object-store lookup per record per run. The lake still has the last
 * word: a record that differs is a put it may call `unchanged`. Nothing here knows WHICH field
 * changed -- a moved file and an edited one are both simply a record that differs.
 *
 * **A folder record names its id and the folder whose listing found it, and nothing else.** No
 * name, because a person wrote it (ADR 0015); no `modifiedTime`, because it moves with the
 * folder's contents and would land versions no model needs. A picked folder names no parent:
 * its own is outside the pick and is never read.
 */

import { canonicalJson } from "@undercroft/core";
import { sha256Hex } from "@undercroft/lake";

import type { RecordToLand } from "../land.ts";
import { type DriveFile, ENTITY, type FoldersListed } from "./driveListing.ts";
import type { HarvestItem, StoredDigests } from "./harvest.ts";

/** The stream a walk's folders land in, beside the files in {@link ENTITY}. ADR 0078. */
export const FOLDER_ENTITY = "folders";

/**
 * How many listed files one skip-known probe covers, and how many folders one digest probe.
 *
 * The listing streams, so nothing here holds the tree; this is only how many files are
 * gathered before one round trip asks which of them we already hold. Small enough that the
 * hold is noise against a 1 GiB budget, large enough that a folder of ten thousand files
 * costs fifty statements rather than ten thousand.
 */
export const PROBE_BATCH = 200;

/** The row that lands in `raw.records`: Drive's own facts about the file, canonicalised. */
export function toRecord(file: DriveFile): RecordToLand {
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
 * One pick's folders into the walk's. A folder already recorded with a parent keeps it; one
 * recorded as a picked folder, with none, takes the parent another pick's listing found. Both
 * folders are inside the selection, so the longer chain reveals nothing outside it.
 */
export function mergeFolders(into: Map<string, string | null>, pick: FoldersListed): void {
  for (const [id, parent] of pick) {
    if ((into.get(id) ?? null) === null) {
      into.set(id, parent);
    }
  }
}

/**
 * The walk's folders as records, each landed only when it differs from the one held. A folder
 * has no documents, so its item is record-only and never marked.
 */
export async function* landFolders(
  listed: FoldersListed,
  digests: StoredDigests,
): AsyncGenerator<HarvestItem, void> {
  const records = [...listed].map(([id, parent]) => folderRecord(id, parent));
  for (let from = 0; from < records.length; from += PROBE_BATCH) {
    const batch = records.slice(from, from + PROBE_BATCH);
    const same = await unchangedRecords(batch, FOLDER_ENTITY, digests);
    for (const record of batch) {
      if (!same.has(record.sourceRecordId)) {
        yield { record, documents: [], recordOnly: true };
      }
    }
  }
}

function folderRecord(id: string, parent: string | null): RecordToLand {
  return {
    entity: FOLDER_ENTITY,
    sourceRecordId: id,
    sourceUpdatedAt: null,
    payloadText: canonicalJson({ id, parents: parent === null ? [] : [parent] }),
  };
}

const encoder = new TextEncoder();

/** Which of these records of one entity this source already holds byte for byte. */
export async function unchangedRecords(
  records: readonly RecordToLand[],
  entity: string,
  digests: StoredDigests,
): Promise<Set<string>> {
  if (records.length === 0) {
    return new Set();
  }
  const stored = await digests(
    entity,
    records.map((record) => record.sourceRecordId),
  );
  const same = new Set<string>();
  for (const record of records) {
    const digest = await sha256Hex(encoder.encode(record.payloadText));
    if (stored.get(record.sourceRecordId) === digest) {
      same.add(record.sourceRecordId);
    }
  }
  return same;
}
