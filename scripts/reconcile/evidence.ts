/**
 * Where a run's evidence goes, and the two reports built from its results.
 *
 * TWO AUDIENCES, TWO FILES. The detailed evidence -- every record's key, verdict and the field
 * values that differed -- names real messages, files and deals. It is written only under the
 * run's `outDir`, which `loadConfig` has already proved to be outside the repository. The
 * summary report carries test ids, client labels (CASE-IDs), statuses and counts: nothing a
 * reader could turn back into a client's name or a message's subject. It is the only artefact
 * meant to be copied anywhere else, and even that copy is a human decision.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  type RecordResult,
  type RunSummary,
  STATUSES,
  summarise,
  type TestResult,
} from "./model.ts";

export interface EvidenceSink {
  /** Write rows as JSON Lines; returns the path relative to the run folder. */
  rows: (name: string, rows: readonly unknown[]) => string;
  /** Write one JSON document; returns the path relative to the run folder. */
  json: (name: string, value: unknown) => string;
  /**
   * Every record a leg judged, matches included -- for a reader that reports record by record,
   * like the live test. A sink that only keeps evidence leaves it out.
   */
  judged?: (caseId: string, records: readonly RecordResult[]) => void;
}

const UNSAFE_NAME = /[^0-9A-Za-z._-]/gu;

/** Evidence files under `<runDir>/evidence`, named from the case id. */
export class FileSink implements EvidenceSink {
  readonly #dir: string;

  constructor(runDir: string) {
    this.#dir = join(runDir, "evidence");
    mkdirSync(this.#dir, { recursive: true });
  }

  rows(name: string, rows: readonly unknown[]): string {
    const lines = rows.map((row) => `${JSON.stringify(row)}\n`).join("");
    return this.#write(name, "jsonl", lines);
  }

  json(name: string, value: unknown): string {
    return this.#write(name, "json", `${JSON.stringify(value, null, 2)}\n`);
  }

  #write(name: string, extension: string, content: string): string {
    const file = evidenceFile(name, extension);
    writeFileSync(join(this.#dir, file), content);
    return `evidence/${file}`;
  }
}

/** A case id made safe as a file name. */
export function evidenceFile(name: string, extension: string): string {
  return `${name.replace(UNSAFE_NAME, "_")}.${extension}`;
}

export interface RunMeta {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly mode: "live" | "offline";
  readonly sources: readonly string[];
  /** Watermarks and snapshot facts per system, as observed at the start of the run. */
  readonly watermarks: Readonly<Record<string, string>>;
}

/** The redacted summary: ids, labels, statuses and counts only. */
export function renderSummary(results: readonly TestResult[], meta: RunMeta): string {
  const summary: RunSummary = summarise(results);
  const lines: string[] = [];
  lines.push(`# Reconciliation run ${meta.runId}`);
  lines.push("");
  lines.push(`- mode: ${meta.mode}`);
  lines.push(`- started: ${meta.startedAt}`);
  lines.push(`- finished: ${meta.finishedAt}`);
  lines.push(`- sources: ${meta.sources.join(", ")}`);
  lines.push(
    `- verdict: exit ${summary.exitCode} (${summary.complete ? "complete" : "NOT complete"})`,
  );
  lines.push(
    `- totals: ${STATUSES.map((status) => `${status}=${summary.byStatus[status]}`).join(" ")}`,
  );
  lines.push("");
  lines.push("## Watermarks");
  lines.push("");
  for (const [system, mark] of Object.entries(meta.watermarks)) {
    lines.push(`- ${system}: ${mark}`);
  }
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push("| id | group | source | leg | client | status | counts | reason |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const result of results) {
    const counts = Object.entries(result.counts ?? {})
      .filter(([, value]) => (value ?? 0) > 0)
      .map(([verdict, value]) => `${verdict}=${value}`)
      .join(" ");
    lines.push(
      `| ${result.id} | ${result.group} | ${result.source} | ${result.leg ?? ""} | ${
        result.client ?? ""
      } | ${result.status} | ${counts} | ${escapeCell(result.reason)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function writeRun(
  runDir: string,
  results: readonly TestResult[],
  meta: RunMeta,
): { summaryPath: string; resultsPath: string } {
  mkdirSync(runDir, { recursive: true });
  const resultsPath = join(runDir, "results.json");
  const summaryPath = join(runDir, "summary.md");
  writeFileSync(
    resultsPath,
    `${JSON.stringify({ meta, summary: summarise(results), results }, null, 2)}\n`,
  );
  writeFileSync(summaryPath, renderSummary(results, meta));
  return { summaryPath, resultsPath };
}
