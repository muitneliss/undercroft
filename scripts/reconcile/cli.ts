/**
 * The official live reconciliation run.
 *
 *   bun run scripts/reconcile/cli.ts --config <file> [--source gmail,hubspot,drive]
 *     [--client CASE-00,...] [--lake-cache-minutes N]
 *
 * Reads the three systems, writes evidence under the config's `outDir` (outside the repo),
 * and exits with the run's verdict:
 *   0  every case PASS or OUT_OF_SCOPE -- the reconciliation is complete and clean
 *   1  at least one confirmed FAIL
 *   2  no FAIL, but some case PENDING or BLOCKED -- the run did not decide everything
 * A run that cannot start, or dies part-way, exits 2, never 0: the live mode does not report
 * success over cases it could not run. Ordinary CI never calls this; `bun test` covers the
 * logic offline against the stand-ins.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import type { Fetcher } from "../../packages/connector-runtime/src/fetcher.ts";
import { type LiveConfig, loadConfig, type MailboxName, readEnvValue } from "./config.ts";
import { messageOf } from "./errors.ts";
import { type EvidenceSink, FileSink, writeRun } from "./evidence.ts";
import { spawnRunner } from "./exec.ts";
import { runGmailSuite } from "./gmailSuite.ts";
import { createGoogleClient, type GoogleClient, parseAuthorizedUser } from "./google.ts";
import { type CachedReader, cachedUndercroft } from "./lakeCache.ts";
import { type RecordResult, summarise, type TestResult } from "./model.ts";
import { nativeFetcher } from "./nativeFetcher.ts";
import { createOstwinReader, type OstwinReader } from "./ostwin.ts";
import { createUndercroftReader } from "./undercroft.ts";

const SOURCES = ["gmail", "hubspot", "drive"] as const;
type Source = (typeof SOURCES)[number];
const KNOWN_SOURCES: ReadonlySet<string> = new Set(SOURCES);
const USAGE =
  "usage: cli.ts --config <file> [--source gmail,hubspot,drive] [--client LABEL,...] [--lake-cache-minutes N]";

export interface Args {
  readonly config: string;
  readonly sources: readonly Source[];
  readonly clients: readonly string[] | null;
  /** Reuse lake walks saved within this many minutes; 0 reads the lake afresh. */
  readonly lakeCacheMinutes: number;
}

interface Systems {
  readonly config: LiveConfig;
  readonly sink: EvidenceSink;
  readonly ostwin: OstwinReader;
  readonly undercroft: CachedReader;
  readonly fetcher: Fetcher;
  readonly google: Readonly<Record<MailboxName, GoogleClient>>;
}

function isSource(name: string): name is Source {
  return KNOWN_SOURCES.has(name);
}

export function parseArgs(argv: readonly string[]): Args {
  function value(flag: string): string | null {
    const at = argv.indexOf(flag);
    return at === -1 ? null : (argv[at + 1] ?? null);
  }
  const config = value("--config");
  if (config === null) {
    throw new Error(USAGE);
  }
  return {
    config,
    sources: (value("--source") ?? SOURCES.join(",")).split(",").filter(isSource),
    clients: value("--client")?.split(",") ?? null,
    lakeCacheMinutes: Number.parseInt(value("--lake-cache-minutes") ?? "0", 10),
  };
}

function runId(now: Date): string {
  return now.toISOString().replaceAll(":", "").replace(".", "-");
}

function lakeReader(config: LiveConfig, minutes: number): CachedReader {
  const cacheDir = join(config.outDir, "lake-cache");
  mkdirSync(cacheDir, { recursive: true });
  function file(name: string): string {
    return join(cacheDir, `${name}.json`);
  }
  return cachedUndercroft(
    createUndercroftReader(spawnRunner(), config.tenantId),
    {
      read: (name) =>
        existsSync(file(name)) ? JSON.parse(readFileSync(file(name), "utf8")) : null,
      write: (name, walk) =>
        writeFileSync(file(name), JSON.stringify({ savedAt: Date.now(), walk })),
    },
    minutes * 60_000,
    () => Date.now(),
  );
}

function openSystems(config: LiveConfig, runDir: string, args: Args): Systems {
  const fetcher = nativeFetcher(60_000);
  function client(name: MailboxName): GoogleClient {
    const token = readFileSync(config.mailboxes[name].tokenFile, "utf8");
    return createGoogleClient(fetcher, parseAuthorizedUser(token));
  }
  return {
    config,
    sink: new FileSink(runDir),
    ostwin: createOstwinReader(spawnRunner(), config.ostwinRoot),
    undercroft: lakeReader(config, args.lakeCacheMinutes),
    fetcher,
    google: { primary: client("primary"), secondary: client("secondary") },
  };
}

/** What each system's data is as of, recorded before any comparison. */
async function watermarks(systems: Systems): Promise<Record<string, string>> {
  const marks: Record<string, string> = {};
  const mart = await systems.ostwin.watermark();
  marks.ostwin = `${mart.mart} built ${mart.builtAt} contract=${mart.contract}${mart.stale ? " STALE" : ""}`;
  const summary = await systems.undercroft.summary();
  for (const stream of summary.records) {
    marks[`undercroft ${stream.source}/${stream.entity}`] =
      `${stream.records} records, latest observed ${stream.latestObservedAt}`;
  }
  systems.sink.json("watermarks", { ostwinHeader: mart.header, undercroft: summary });
  return marks;
}

async function runSuites(systems: Systems, sources: readonly Source[]): Promise<TestResult[]> {
  const results: TestResult[] = [];
  if (sources.includes("gmail")) {
    results.push(...(await runGmailSuite(systems)));
  }
  if (sources.includes("hubspot")) {
    const { runHubSpotSuite } = await import("./hubspotSuite.ts");
    const token = readEnvValue(systems.config.hubspotEnvFile, "HUBSPOT_ACCESS_TOKEN");
    results.push(...(await runHubSpotSuite({ ...systems, token })));
  }
  if (sources.includes("drive")) {
    const { runDriveSuite } = await import("./driveSuite.ts");
    results.push(...(await runDriveSuite(systems)));
  }
  return results;
}

export interface Execution {
  readonly runId: string;
  readonly runDir: string;
  readonly results: readonly TestResult[];
  readonly summaryPath: string;
  readonly exitCode: 0 | 1 | 2;
}

export type JudgedListener = (caseId: string, records: readonly RecordResult[]) => void;

/** Every judged leg is announced on stderr as it finishes, so a long run shows its progress. */
function withProgress(sink: EvidenceSink, listener: JudgedListener | undefined): EvidenceSink {
  return {
    rows: (name, rows) => sink.rows(name, rows),
    json: (name, value) => sink.json(name, value),
    judged: (caseId, records): void => {
      const at = new Date().toISOString().slice(11, 19);
      process.stderr.write(`[${at}] ${caseId}: ${records.length} record(s) judged\n`);
      listener?.(caseId, records);
    },
  };
}

/** One live run: read the three systems, judge every case, write the run folder. */
export async function execute(args: Args, listener?: JudgedListener): Promise<Execution> {
  const loaded = loadConfig(args.config, resolve(import.meta.dir, "..", ".."));
  const config: LiveConfig =
    args.clients === null
      ? loaded
      : {
          ...loaded,
          clients: loaded.clients.filter((client) => args.clients?.includes(client.label)),
        };
  const started = new Date();
  const id = runId(started);
  const runDir = join(config.outDir, id);
  const opened = openSystems(config, runDir, args);
  const systems = { ...opened, sink: withProgress(opened.sink, listener) };
  const marks = await watermarks(systems);
  const results = await runSuites(systems, args.sources);
  for (const [name, at] of systems.undercroft.snapshots) {
    marks[`lake snapshot ${name}`] = at;
  }
  const meta = {
    runId: id,
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    mode: "live" as const,
    sources: args.sources,
    watermarks: marks,
  };
  const { summaryPath } = writeRun(runDir, results, meta);
  return { runId: id, runDir, results, summaryPath, exitCode: summarise(results).exitCode };
}

export async function main(argv: readonly string[]): Promise<0 | 1 | 2> {
  const run = await execute(parseArgs(argv));
  const verdict = summarise(run.results);
  const line = {
    run: run.runId,
    summary: run.summaryPath,
    total: verdict.total,
    byStatus: verdict.byStatus,
    exit: verdict.exitCode,
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
  return verdict.exitCode;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`reconcile: ${messageOf(error)}\n`);
      // A run that could not complete is incomplete, never clean.
      process.exit(2);
    },
  );
}
