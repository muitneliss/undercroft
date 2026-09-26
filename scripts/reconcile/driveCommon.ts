/**
 * What the per-client Drive legs share: one client's trees as read from each root, OSTWIN's
 * inventory rows for the client, and the lake sources -- gathered once so each leg takes one
 * context instead of a long parameter list.
 */

import type { ClientConfig, DriveRootConfig } from "./config.ts";
import type { DriveFile } from "./drive.ts";
import type { LakeSource } from "./driveLake.ts";
import { relativePath } from "./keys.ts";
import type { Row } from "./ostwin.ts";

const DRIVE_URL_ID = /\/d\/(?<path>[\w-]{20,})|[?&]id=(?<query>[\w-]{20,})/u;

/** One root as read for one client. */
export interface RootRead {
  readonly root: DriveRootConfig;
  /** How many client folders the config pins in this root: 0, 1, or more when duplicated. */
  readonly folders: number;
  readonly files: readonly DriveFile[];
  /** Every folder's listing ended and no read failed. */
  readonly complete: boolean;
}

/** A row of OSTWIN's file inventory, keyed the two ways OSTWIN can identify a file. */
export interface OstwinFile {
  readonly sourceRoot: string;
  readonly path: string;
  readonly driveId: string | null;
  readonly inventoriedAt: string | null;
}

export interface ClientDrive {
  readonly client: ClientConfig;
  readonly roots: ReadonlyMap<string, RootRead>;
  readonly ostwin: readonly OstwinFile[];
  readonly lakes: ReadonlyMap<string, LakeSource>;
}

/**
 * One row per file. OSTWIN keeps several inventories (legal, financials, targeted) and one file
 * can sit in two of them; that is two views of one file, not a duplicate in the warehouse.
 */
export function distinctFiles(rows: readonly OstwinFile[]): OstwinFile[] {
  const seen = new Map<string, OstwinFile>();
  for (const row of rows) {
    const key = `${row.sourceRoot}|${row.driveId ?? `path:${row.path}`}`;
    if (!seen.has(key)) {
      seen.set(key, row);
    }
  }
  return [...seen.values()];
}

export function toOstwinFile(row: Row): OstwinFile {
  const groups = DRIVE_URL_ID.exec(row.entry_url ?? "")?.groups;
  const parent = row.parent_path ?? "";
  const name = row.entry_name ?? "";
  return {
    sourceRoot: row.source_root ?? "",
    path: relativePath(parent.length === 0 ? name : `${parent}/${name}`),
    driveId: groups?.path ?? groups?.query ?? null,
    inventoriedAt: row.inventoried_at ?? null,
  };
}

/** The earliest OSTWIN scan among rows: nothing modified after it can be held against OSTWIN. */
export function scannedAt(rows: readonly OstwinFile[]): number | null {
  const times = rows
    .map((row) => Date.parse(row.inventoriedAt ?? ""))
    .filter((at) => !Number.isNaN(at));
  return times.length === 0 ? null : times.reduce((low, at) => Math.min(low, at));
}

/** Modified at or before a watermark; an unknown watermark is never "synced". */
export function modifiedBefore(file: DriveFile, mark: number | null): boolean {
  return mark !== null && Date.parse(file.modifiedTime) <= mark;
}
