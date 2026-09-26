/**
 * The live reconciliation as a test run: one test per real record, mapped 1:1.
 *
 *   UNDERCROFT_LIVE=1 bun test ./scripts/reconcile/live/records.live.ts
 *
 * This folder holds the checks that read REAL data, kept apart from the framework's offline
 * tests one level up. The `.live.ts` suffix is outside `bun test`'s default pattern, so neither
 * `bun run test` nor CI ever collects it: it runs only when named by path, by someone holding
 * the local configuration and read credentials. The sources are read only through their APIs
 * and the Undercroft CLI -- never a database.
 *
 * "Email A has data, so the lake must have it" is literally one test here: for every client in
 * the local configuration, every message its scope query finds, every deal linked to its
 * company and every file in its folders becomes its own `it`, named by the record's id and the
 * leg it is judged on. A record that is present with equal fields passes; one missing, extra,
 * duplicated or different fails with the reason. A record newer than the lake's last completed
 * run is `todo` (PENDING, never a pass), and one the confirmed scope excludes is `skip` with the
 * rule that excludes it.
 *
 * The configuration and every real value stay local: the config is read from `fixtures/live/`
 * (git-ignored) or `UNDERCROFT_LIVE_CONFIG`, and evidence goes to its `outDir`, outside the
 * repository. `UNDERCROFT_LIVE=1` is a second, explicit consent: named without it, the file
 * registers one `todo` and reads nothing. Portal- and mailbox-wide legs (tens of
 * thousands of records) are reported as one test each with their counts; the per-record tests
 * are the client-scoped legs.
 */
import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import process from "node:process";

import { execute } from "../cli.ts";
import type { RecordResult, TestResult } from "../model.ts";

const REPO = resolve(import.meta.dirname, "..", "..", "..");
const LIVE = process.env.UNDERCROFT_LIVE === "1";
const CONFIG =
  process.env.UNDERCROFT_LIVE_CONFIG ?? join(REPO, "fixtures", "live", "reconcile.config.json");
const DEFECTS = new Set(["MISSING", "EXTRA", "DUPLICATE", "CONTENT_MISMATCH"]);
const ALL_SOURCES = ["gmail", "hubspot", "drive"] as const;
/** `UNDERCROFT_LIVE_SOURCES=drive` re-runs one source; the default is all three. */
const SOURCES = ALL_SOURCES.filter((source) =>
  (process.env.UNDERCROFT_LIVE_SOURCES ?? ALL_SOURCES.join(",")).split(",").includes(source),
);

function recordTest(record: RecordResult): void {
  const fields = record.diffs.map((diff) => diff.field).join(", ");
  const name = `${record.key} ${record.verdict}${record.reason.length > 0 ? ` -- ${record.reason}` : ""}`;
  if (record.verdict === "NOT_YET_SYNCED") {
    // PENDING: the lake has not finished a run that could hold it. Never a pass.
    it.todo(name, () => undefined);
  } else if (record.verdict === "OUT_OF_SCOPE" || record.verdict === "EXCLUDED_BY_RULE") {
    // Outside the confirmed scope: reported with its rule, neither passed nor failed.
    it.skipIf(true)(name, () => undefined);
  } else {
    it(name, () => {
      // Field names only in the message: values can be client data, and stay in the evidence.
      expect(
        DEFECTS.has(record.verdict) ? `${record.verdict}${fields ? ` (${fields})` : ""}` : "MATCH",
      ).toBe("MATCH");
    });
  }
}

function caseTest(result: TestResult): void {
  const name = `${result.status}: ${result.title}${result.reason ? ` -- ${result.reason}` : ""}`;
  if (result.status === "PENDING" || result.status === "BLOCKED") {
    it.todo(name, () => undefined);
  } else if (result.status === "OUT_OF_SCOPE") {
    it.skipIf(true)(name, () => undefined);
  } else {
    it(name, () => {
      expect(result.status).toBe("PASS");
    });
  }
}

if (LIVE) {
  const judged = new Map<string, readonly RecordResult[]>();
  const run = await execute(
    {
      config: CONFIG,
      sources: SOURCES,
      clients: null,
      lakeCacheMinutes: 720,
    },
    (caseId, records) => judged.set(caseId, records),
  );
  describe(`live run ${run.runId} (summary: ${run.summaryPath})`, () => {
    for (const result of run.results) {
      const records = judged.get(result.id) ?? [];
      if (result.client !== undefined && records.length > 0) {
        describe(`${result.id} [${result.status}] ${result.title}`, () => {
          for (const record of records) {
            recordTest(record);
          }
        });
      } else {
        describe(result.id, () => caseTest(result));
      }
    }
  });
}

if (!LIVE) {
  it.todo("live reconciliation: needs UNDERCROFT_LIVE=1 and a local config in fixtures/live/", () =>
    undefined);
}
