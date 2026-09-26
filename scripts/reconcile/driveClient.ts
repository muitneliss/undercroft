/**
 * One client's Drive cases: read each root's client folders from the source, read OSTWIN's
 * inventory for the client, then run the legs each root allows -- S->U where Undercroft reads
 * the root, S->O where OSTWIN scans it, O->U where both do.
 */

import { makeCase } from "./cases.ts";
import type { ClientConfig, DriveRootConfig } from "./config.ts";
import type { DriveFile } from "./drive.ts";
import { type ClientDrive, distinctFiles, type RootRead, toOstwinFile } from "./driveCommon.ts";
import type { DriveDeps, LakeSource } from "./driveLake.ts";
import { documentsCase, s2uCase } from "./driveLegs.ts";
import { s2oCase } from "./driveS2O.ts";
import { o2uAcrossTrees, o2uSameTree } from "./driveO2U.ts";
import type { TestResult } from "./model.ts";
import { sqlText } from "./ostwin.ts";

/** OSTWIN's `source_root` for each configured root role that OSTWIN scans. */
const OSTWIN_ROOT: Readonly<Record<string, string>> = {
  "incorp-mydrive": "incorp_active",
  bookkeeping: "bookkeeping",
};
const INVENTORY_COLUMNS = [
  "source_root",
  "parent_path",
  "entry_name",
  "entry_url",
  "inventoried_at",
];

async function readRoot(
  deps: DriveDeps,
  client: ClientConfig,
  root: DriveRootConfig,
): Promise<RootRead> {
  const folders = client.driveFolders.filter((folder) => folder.role === root.role);
  const files: DriveFile[] = [];
  let complete = true;
  for (const folder of folders) {
    try {
      const tree = await deps.google[root.readAs].driveTree(folder.folderId);
      files.push(...tree.files);
      complete &&= tree.incomplete.length === 0;
    } catch {
      complete = false;
    }
  }
  return { root, folders: folders.length, files, complete };
}

function folderCase(deps: DriveDeps, client: ClientConfig, read: RootRead): TestResult {
  const { folders, root } = read;
  let status: TestResult["status"] = folders === 1 ? "PASS" : "FAIL";
  let reason =
    folders === 1
      ? ""
      : `source hygiene: ${folders} folders for one client in ${root.role}; files split across them`;
  if (folders === 0) {
    status = "OUT_OF_SCOPE";
    reason = `no ${root.role} folder for this client: nothing in this root to compare`;
  }
  return makeCase(
    "drive",
    {
      id: `DR-${client.label}-FOLDER-001-${root.role}`,
      title: `The client has exactly one folder in ${root.role}`,
    },
    {
      client: client.label,
      group: "integration",
      requirement: "REQ-DR-01 one client, one folder per root, so files attribute to one client",
      contract: "Drive layout: <root>/Active/<CLIENT>",
      ...(folders > 1 ? { finding: "duplicate client folders (2026-09-25 scope survey)" } : {}),
      preconditions: "folder ids pinned in the local config",
      expected: "1 folder",
      actual: `${folders} folder(s)`,
      status,
      reason,
      evidence: [
        {
          label: "folders",
          path: deps.sink.json(`DR-${client.label}-FOLDER-${root.role}`, { folders }),
        },
      ],
    },
  );
}

function rootCases(deps: DriveDeps, drive: ClientDrive, read: RootRead): TestResult[] {
  const results: TestResult[] = [folderCase(deps, drive.client, read)];
  if (read.root.undercroftSource !== null) {
    results.push(s2uCase(deps, drive, read), documentsCase(deps, drive, read));
  }
  const ostwinRoot = OSTWIN_ROOT[read.root.role];
  if (read.root.ostwinScans && ostwinRoot !== undefined) {
    const rows = drive.ostwin.filter((row) => row.sourceRoot === ostwinRoot);
    results.push(s2oCase(deps, drive, read, rows));
    if (read.root.undercroftSource !== null) {
      results.push(o2uSameTree(deps, drive, read, rows));
    }
  }
  return results;
}

export async function clientCases(
  deps: DriveDeps,
  client: ClientConfig,
  lakes: ReadonlyMap<string, LakeSource>,
): Promise<TestResult[]> {
  const roots = new Map<string, RootRead>();
  for (const root of deps.config.driveRoots) {
    roots.set(root.role, await readRoot(deps, client, root));
  }
  const where = `WHERE client_id = ${sqlText(client.clientId)} AND entry_kind = 'file'`;
  const rows = await deps.ostwin.fullRows(
    `SELECT ${INVENTORY_COLUMNS.join(", ")} FROM document_index ${where}`,
    INVENTORY_COLUMNS,
  );
  const drive: ClientDrive = {
    client,
    roots,
    ostwin: distinctFiles(rows.map(toOstwinFile)),
    lakes,
  };
  const results = [...roots.values()].flatMap((read) => rootCases(deps, drive, read));
  const across = o2uAcrossTrees(
    deps,
    drive,
    drive.ostwin.filter((row) => row.sourceRoot === "incorp_active"),
  );
  return across === null ? results : [...results, across];
}
