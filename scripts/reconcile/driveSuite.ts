/**
 * The Google Drive reconciliation: SOURCE (the live Drive trees) <-> OSTWIN (its file
 * inventory) <-> UNDERCROFT (the lake's `drive*` sources: `files` records and `documents`).
 *
 * THE TWO WAREHOUSES DO NOT READ THE SAME TREES. Undercroft reads the Incorp client folders on
 * the Shared drive and the Bookkeeping root; OSTWIN reads the Incorp client folders on My Drive
 * and the same Bookkeeping root. The lake-wide cases run first (`driveLake.ts`), then each
 * client's legs (`driveClient.ts`). A client whose trees cannot be read becomes that client's
 * BLOCKED case; it does not end the run.
 */

import { makeCase } from "./cases.ts";
import {
  type DriveDeps,
  documentsHaveFilesCase,
  extractionBacklogCase,
  type LakeSource,
  lakeWalkCase,
  loadLakeSource,
} from "./driveLake.ts";
import { runLedgerCases } from "./driveLedger.ts";
import { clientCases } from "./driveClient.ts";
import { messageOf } from "./errors.ts";
import type { TestResult } from "./model.ts";

export type { DriveDeps } from "./driveLake.ts";

export async function runDriveSuite(deps: DriveDeps): Promise<TestResult[]> {
  const context = {
    runs: await deps.undercroft.runs(100),
    summary: await deps.undercroft.summary(),
    connections: await deps.undercroft.connections(),
  };
  const lakes = new Map<string, LakeSource>();
  for (const root of deps.config.driveRoots) {
    const lake =
      root.undercroftSource === null || lakes.has(root.undercroftSource)
        ? null
        : await loadLakeSource(deps, root, context);
    if (lake !== null) {
      lakes.set(lake.source, lake);
    }
  }
  const results: TestResult[] = [];
  for (const lake of lakes.values()) {
    const documents = context.summary.documents.find((entry) => entry.source === lake.source);
    results.push(
      lakeWalkCase(deps, lake, context.runs),
      documentsHaveFilesCase(deps, lake),
      extractionBacklogCase(deps, lake, documents),
    );
  }
  results.push(...runLedgerCases(deps, context.runs));
  for (const client of deps.config.clients) {
    try {
      results.push(...(await clientCases(deps, client, lakes)));
    } catch (error) {
      results.push(
        makeCase(
          "drive",
          { id: `DR-${client.label}-RUN`, title: `Drive cases for ${client.label}` },
          {
            client: client.label,
            requirement: "REQ-GEN-01 the source is read live",
            contract: "Drive v3 files.list; OSTWIN document_index",
            preconditions: "Drive and OSTWIN readable",
            expected: "client cases run",
            actual: "not run",
            status: "BLOCKED",
            reason: messageOf(error),
            evidence: [],
          },
        ),
      );
    }
  }
  return results;
}
