/**
 * The live run's local files: the configuration it reads and the evidence it writes.
 *
 * The configuration. NOTHING HERE IS COMMITTED WITH REAL VALUES: the file names the
 * tenant, the lake sources and the token files, so it lives in `fixtures/live/` (git-ignored) or
 * outside the repository. `live/drive.config.example.json` shows the shape with placeholders.
 *
 * `outDir` must be outside the repository: the evidence (`judged.jsonl`, one line per record,
 * and `summary.json`, the counts) names real file ids. `loadConfig` refuses one inside it rather
 * than trusting `.gitignore`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import type { Credentials } from "./driveApi.ts";
import { DEFECTS } from "./driveJudge.ts";
import type { DriveRun } from "./driveRun.ts";
import { obj, str } from "./reads.ts";

export interface DriveConfig {
  readonly tenantId: string;
  /** The CLI profile to read with; its `allowWrites` must be false. The active one when absent. */
  readonly profile?: string;
  readonly outDir: string;
  /** Each Drive lake source, and the read-only token that reads the same Drive account. */
  readonly connections: readonly { source: string; tokenFile: string }[];
  /** Files per connection downloaded and hashed; 0 downloads nothing. */
  readonly hashSample: number;
  /** Drive folder listings and lookups at once. */
  readonly concurrency: number;
}

function need(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`config: ${field} must be a non-empty string`);
  }
  return value.trim();
}

function whole(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function loadConfig(path: string, repoRoot: string): DriveConfig {
  const body = obj(JSON.parse(readFileSync(path, "utf8")));
  const outDir = resolve(need(body.outDir, "outDir"));
  const repo = resolve(repoRoot);
  if (outDir === repo || outDir.startsWith(`${repo}${sep}`)) {
    throw new Error("config: outDir is inside the repository; evidence names real files");
  }
  const connections = Array.isArray(body.connections) ? body.connections : [];
  return {
    tenantId: need(body.tenantId, "tenantId"),
    ...(body.profile === undefined ? {} : { profile: need(body.profile, "profile") }),
    outDir,
    connections: connections.map((item, index) => {
      const entry = obj(item);
      return {
        source: need(entry.source, `connections[${index}].source`),
        tokenFile: need(entry.tokenFile, `connections[${index}].tokenFile`),
      };
    }),
    hashSample: whole(body.hashSample, 0),
    concurrency: Math.max(1, whole(body.concurrency, 4)),
  };
}

/** An authorized-user token file, keeping only what a refresh needs. */
export function readCredentials(path: string): Credentials {
  const body = obj(JSON.parse(readFileSync(path, "utf8")));
  return {
    refresh_token: str(body.refresh_token),
    client_id: str(body.client_id),
    client_secret: str(body.client_secret),
  };
}

/** One line per record, and the counts per group, under the run's own directory. */
export function writeEvidence(dir: string, run: Omit<DriveRun, "dir">): void {
  const lines = run.groups.flatMap((group) =>
    group.records.map((record) => JSON.stringify({ group: group.id, ...record })),
  );
  writeFileSync(join(dir, "judged.jsonl"), `${lines.join("\n")}\n`);
  const counts = run.groups.map((group) => {
    const byVerdict: Record<string, number> = {};
    for (const record of group.records) {
      byVerdict[record.verdict] = (byVerdict[record.verdict] ?? 0) + 1;
    }
    const defects = group.records.filter((record) => DEFECTS.has(record.verdict)).length;
    return { group: group.id, verdicts: byVerdict, defects };
  });
  const summary = { runId: run.runId, outcome: run.outcome, counts };
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
}
