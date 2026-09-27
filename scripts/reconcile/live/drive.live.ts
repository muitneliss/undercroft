/**
 * The Drive reconciliation over REAL data, one test per record, mapped 1:1:
 *
 *   task ci:reconcile-drive-live
 *
 * "File A is in the picked Drive folder, so the lake must hold it" is literally one test here:
 * every file under a connection's picks, of a type it takes, becomes its own `it`, named by the
 * Drive file id, and passes only when the lake holds it once with Drive's fields and its bytes.
 * Every lake record the tree no longer holds is one test too, and so is every sampled download.
 *
 * - A defect (`MISSING`, `CONTENT_MISMATCH`) fails, naming the fields -- never their values.
 * - `NOT_YET_SYNCED` (newer than the last completed run) and `BLOCKED` (the systems expose no
 *   evidence to decide) are `todo`: never a pass, never a failure.
 * - `OUT_OF_SCOPE` and `EXCLUDED_BY_RULE` are skipped with the rule in the name.
 *
 * This folder holds the only checks that read real data. The `.live.ts` suffix is outside
 * `bun test`'s default pattern, so neither the gate nor CI collects it. It reads Undercroft only
 * through its CLI's read commands and Drive only with a read-only token -- never a database. The
 * config (tenant, sources, token paths) stays local in `fixtures/live/` (git-ignored) or at
 * `UNDERCROFT_LIVE_CONFIG`; the evidence goes to its `outDir`, outside the repository.
 */
import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import process from "node:process";

import { DEFECTS, type Judged } from "../driveJudge.ts";
import { DriveReader } from "../driveApi.ts";
import { loadConfig, readCredentials } from "../driveConfig.ts";
import { runDrive } from "../driveRun.ts";
import { bunHttp, spawnRunner } from "../reads.ts";
import { UndercroftReader } from "../undercroftCli.ts";

const REPO = resolve(import.meta.dirname, "..", "..", "..");
const CONFIG =
  process.env.UNDERCROFT_LIVE_CONFIG ?? join(REPO, "fixtures", "live", "drive.config.json");

function recordTest(record: Judged): void {
  const name = `${record.id} ${record.verdict}${record.reason.length > 0 ? ` -- ${record.reason}` : ""}`;
  if (record.verdict === "NOT_YET_SYNCED" || record.verdict === "BLOCKED") {
    it.todo(name, () => undefined);
  } else if (record.verdict === "OUT_OF_SCOPE" || record.verdict === "EXCLUDED_BY_RULE") {
    it.skipIf(true)(name, () => undefined);
  } else {
    it(name, () => {
      const fields = record.fields.join(", ");
      expect(DEFECTS.has(record.verdict) ? `${record.verdict} (${fields})` : record.verdict).toBe(
        "MATCH",
      );
    });
  }
}

if (process.env.UNDERCROFT_LIVE === "1") {
  const config = loadConfig(CONFIG, REPO);
  const tokens = new Map(config.connections.map((entry) => [entry.source, entry.tokenFile]));
  const run = await runDrive(config, {
    undercroft: new UndercroftReader(spawnRunner, config.tenantId, config.profile),
    drive: (source) => new DriveReader(bunHttp, readCredentials(tokens.get(source) ?? "")),
  });
  describe(`drive live run ${run.runId}: ${run.outcome} (evidence: ${run.dir})`, () => {
    for (const group of run.groups) {
      describe(`${group.id}: ${group.title}`, () => {
        for (const record of group.records) {
          recordTest(record);
        }
      });
    }
  });
} else {
  it.todo("drive live reconciliation: needs UNDERCROFT_LIVE=1 and a local config", () => undefined);
}
