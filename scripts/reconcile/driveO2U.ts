/**
 * Drive O->U: OSTWIN's inventory against the lake, over the files both could hold.
 *
 * Bookkeeping is one tree read by both, so an OSTWIN row resolves to a Drive id through the
 * live tree and joins the lake by that id. Incorp is two trees -- OSTWIN reads My Drive, the
 * lake reads the Shared drive copy -- so an OSTWIN row is carried to the Shared drive by its
 * relative path; a row with no counterpart there is outside Undercroft's scope, not missing.
 */

import { reconcileLeg } from "./classify.ts";
import { legCase, stamp } from "./cases.ts";
import type { DriveFile } from "./drive.ts";
import { type ClientDrive, modifiedBefore, type OstwinFile, type RootRead } from "./driveCommon.ts";
import type { DriveDeps } from "./driveLake.ts";
import { keyOstwin } from "./driveS2O.ts";
import { relativePath } from "./keys.ts";
import type { TestResult } from "./model.ts";

const REQUIREMENT = "REQ-DR-07 the two warehouses agree on the files they both read";

interface Carried {
  readonly row: OstwinFile;
  /** The live file this row names in the tree Undercroft reads, if any. */
  readonly counterpart: DriveFile | undefined;
}

function o2u(
  deps: DriveDeps,
  drive: ClientDrive,
  spec: {
    id: string;
    title: string;
    contract: string;
    lakeSource: string | null;
    carried: readonly { key: string; record: Carried }[];
  },
): TestResult {
  const lake = drive.lakes.get(spec.lakeSource ?? "");
  const mark = lake?.filesWatermark ?? null;
  const records = reconcileLeg({
    reference: spec.carried.map(({ key, record }) => ({
      key,
      record,
      evidence: `ostwin:${record.row.sourceRoot} inventoried_at=${record.row.inventoriedAt ?? "?"}`,
    })),
    target: spec.carried.flatMap(({ key }) =>
      (lake?.byId.get(key) ?? []).map((row) => ({
        key,
        record: row,
        evidence: `lake:${row.source}/files/${key}`,
      })),
    ),
    inScope: ({ counterpart }) => ({
      inScope: counterpart !== undefined,
      reason: "no live file for this row in the tree Undercroft reads",
    }),
    synced: ({ counterpart }) => counterpart !== undefined && modifiedBefore(counterpart, mark),
    compare: () => [],
    targetBelongs: () => false,
  });
  const meta = {
    source: "drive" as const,
    id: spec.id,
    title: spec.title,
    leg: "O2U" as const,
    client: drive.client.label,
    requirement: REQUIREMENT,
    contract: spec.contract,
    preconditions: `last completed lake files run ${stamp(mark)}`,
    expected: "every OSTWIN file with a live counterpart in Undercroft's scope is in the lake",
    facts: { ostwinRows: spec.carried.length },
  };
  return legCase(
    deps.sink,
    meta,
    records,
    lake !== undefined && lake.files !== null && mark !== null,
  );
}

/** Bookkeeping: one tree, so OSTWIN's rows join the lake by the id the live tree gives them. */
export function o2uSameTree(
  deps: DriveDeps,
  drive: ClientDrive,
  read: RootRead,
  rows: readonly OstwinFile[],
): TestResult {
  const carried = keyOstwin(read.files, rows).map(({ key, row, file }) => ({
    key,
    record: { row, counterpart: file },
  }));
  return o2u(deps, drive, {
    id: `DR-${drive.client.label}-O2U-${read.root.role}`,
    title: `Drive ${read.root.role}: OSTWIN inventory vs Undercroft files`,
    contract: "same tree; join by Drive id (OSTWIN path resolved through the live tree)",
    lakeSource: read.root.undercroftSource,
    carried,
  });
}

/** Incorp: OSTWIN's My Drive rows, carried to the Shared drive copy by relative path. */
export function o2uAcrossTrees(
  deps: DriveDeps,
  drive: ClientDrive,
  rows: readonly OstwinFile[],
): TestResult | null {
  const mydrive = drive.roots.get("incorp-mydrive");
  const shared = drive.roots.get("incorp-shared");
  if (mydrive === undefined || shared === undefined || shared.root.undercroftSource === null) {
    return null;
  }
  const mydriveById = new Map(mydrive.files.map((file) => [file.id, file] as const));
  const sharedByPath = new Map(
    shared.files.map((file) => [relativePath(file.path), file] as const),
  );
  const mapped = rows.map((row) => {
    const path =
      row.driveId === null
        ? row.path
        : relativePath(mydriveById.get(row.driveId)?.path ?? row.path);
    const counterpart = sharedByPath.get(path);
    return { key: counterpart?.id ?? `mydrive:${path}`, record: { row, counterpart } };
  });
  // Two OSTWIN inventories naming one file carry it once.
  const carried = [...new Map(mapped.map((entry) => [entry.key, entry] as const)).values()];
  return o2u(deps, drive, {
    id: `DR-${drive.client.label}-O2U-incorp`,
    title: "Drive Incorp: OSTWIN (My Drive) vs Undercroft (Shared drive) over common paths",
    contract:
      "OSTWIN reads My Drive, Undercroft the Shared drive copy; common scope = same relative path",
    lakeSource: shared.root.undercroftSource,
    carried,
  });
}
