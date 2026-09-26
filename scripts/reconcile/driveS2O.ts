/**
 * Drive S->O: each client folder OSTWIN scans, against OSTWIN's file inventory. OSTWIN keeps a
 * Drive id for some rows (its legal inventory stores the Drive URL) and only a path for the rest,
 * so a row joins by id when it has one and by its path relative to the client folder otherwise.
 * The file NAME is compared, not the path: OSTWIN's legal inventory records a folder role
 * (`corpsec`) as the parent, not the folder's real name.
 */

import { legCase, stamp } from "./cases.ts";
import { reconcileLeg } from "./classify.ts";
import type { DriveFile } from "./drive.ts";
import {
  type ClientDrive,
  modifiedBefore,
  type OstwinFile,
  type RootRead,
  scannedAt,
} from "./driveCommon.ts";
import type { DriveDeps } from "./driveLake.ts";
import { legMeta } from "./driveLegs.ts";
import { relativePath } from "./keys.ts";
import type { TestResult } from "./model.ts";

/**
 * OSTWIN rows keyed by the live file they name: by Drive id when OSTWIN kept one, else by the
 * file at their path. One file named by two inventories -- once by id, once by path -- resolves
 * to one key and is kept once: two views of one file, not a duplicate in the warehouse.
 */
export function keyOstwin(
  files: readonly DriveFile[],
  rows: readonly OstwinFile[],
): { key: string; row: OstwinFile; file: DriveFile | undefined }[] {
  const byPath = new Map(files.map((file) => [relativePath(file.path), file] as const));
  const byId = new Map(files.map((file) => [file.id, file] as const));
  const kept = new Map<string, { key: string; row: OstwinFile; file: DriveFile | undefined }>();
  for (const row of rows) {
    const file = row.driveId === null ? byPath.get(row.path) : byId.get(row.driveId);
    const key = file?.id ?? row.driveId ?? `path:${row.path}`;
    if (!kept.has(key)) {
      kept.set(key, { key, row, file });
    }
  }
  return [...kept.values()];
}

/** The folder a file sits in, relative to the client folder. */
function folderOf(file: DriveFile): string {
  const path = relativePath(file.path);
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

export function s2oCase(
  deps: DriveDeps,
  drive: ClientDrive,
  read: RootRead,
  rows: readonly OstwinFile[],
): TestResult {
  const id = `DR-${drive.client.label}-S2O-${read.root.role}`;
  const scan = scannedAt(rows);
  const keyed = keyOstwin(read.files, rows);
  // OSTWIN's inventories are targeted (legal, financials, a refresh list): its promise is the
  // folders it has read. A file in one of those folders that it lacks is missing; a file in a
  // folder OSTWIN never read is outside its scope.
  const scanned = new Set(
    keyed.flatMap(({ file }) => (file === undefined ? [] : [folderOf(file)])),
  );
  const records = reconcileLeg({
    reference: read.files.map((file) => ({
      key: file.id,
      record: file,
      evidence: `drive:${file.id} depth=${file.depth}`,
    })),
    target: keyed.map(({ key, row }) => ({
      key,
      record: row,
      evidence: `ostwin:document_index inventoried_at=${row.inventoriedAt ?? "?"}`,
    })),
    inScope: (file) => ({
      inScope: scanned.has(folderOf(file)),
      reason: "in a folder none of OSTWIN's inventories has read",
    }),
    synced: (file) => modifiedBefore(file, scan),
    // The name, not the path: OSTWIN's legal inventory records a folder ROLE (`corpsec`,
    // `bizfile`) as the parent, not the folder's real name (`Corp Sec`).
    compare: (file, row) => {
      const name = row.path.split("/").at(-1) ?? "";
      return name === file.name.normalize("NFC")
        ? []
        : [{ field: "name", expected: file.name, actual: name }];
    },
    // A row the tree no longer holds was moved or deleted after OSTWIN's scan; the leg cannot
    // tell that from a phantom row, so such rows are counted in the facts, not called EXTRA.
    targetBelongs: () => false,
  });
  const meta = legMeta(drive, read, {
    id,
    title: `Drive ${read.root.role} vs OSTWIN inventory`,
    leg: "S2O",
    requirement:
      "REQ-DR-06 OSTWIN's file inventory lists every file of the client folders it scans",
    contract: "OSTWIN document_index (file_inventory): Drive URL id when known, else relative path",
    preconditions: `OSTWIN scan ${stamp(scan)}`,
    expected: "every file older than the scan, in a folder OSTWIN reads, inventoried",
    facts: {
      sourceFiles: read.files.length,
      ostwinRows: rows.length,
      ostwinWithDriveId: rows.filter((row) => row.driveId !== null).length,
      ostwinNotInTreeNow: keyed.filter((entry) => entry.file === undefined).length,
      foldersOstwinReads: scanned.size,
      scannedAt: stamp(scan),
    },
  });
  return legCase(deps.sink, meta, records, read.folders > 0 && read.complete && scan !== null);
}
