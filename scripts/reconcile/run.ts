/**
 * One live reconciliation run: open the systems, judge every case, write the run folder.
 *
 * `live/gmail.live.ts` is the only caller -- it turns each judged record into its own test.
 * Evidence goes under the config's `outDir` (outside the repo), and the run's verdict is folded
 * into `summary.md` as an exit code:
 *   0  every case PASS or OUT_OF_SCOPE -- the reconciliation is complete and clean
 *   1  at least one confirmed FAIL
 *   2  no FAIL, but some case PENDING or BLOCKED -- the run did not decide everything
 * Ordinary CI never calls this; `bun test` covers the logic offline against the stand-ins.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { type LiveConfig, loadConfig, type MailboxName } from "./config.ts";
import { type EvidenceSink, FileSink, writeRun } from "./evidence.ts";
import { spawnRunner } from "./exec.ts";
import type { FullMessage } from "./gmail.ts";
import type { SourceCache } from "./gmailCommon.ts";
import { runGmailSuite } from "./gmailSuite.ts";
import { createGoogleClient, type GoogleClient, parseAuthorizedUser } from "./google.ts";
import { arrayOrEmpty, asObject, count, objectOrEmpty, text } from "./json.ts";
import { type CachedReader, cachedUndercroft } from "./lakeCache.ts";
import { type RecordResult, summarise, type TestResult } from "./model.ts";
import { nativeFetcher } from "./nativeFetcher.ts";
import { createUndercroftReader } from "./undercroft.ts";

export interface Args {
  readonly config: string;
  /** Reuse lake walks saved within this many minutes; 0 reads the lake afresh. */
  readonly lakeCacheMinutes: number;
}

interface Systems {
  readonly config: LiveConfig;
  readonly sink: EvidenceSink;
  readonly undercroft: CachedReader;
  readonly google: Readonly<Record<MailboxName, GoogleClient>>;
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

/** A cached read as `readSource` wrote it; null stands for Gmail's 404. */
function cachedMessage(raw: unknown): FullMessage | null {
  if (raw === null) {
    return null;
  }
  const body = asObject(raw);
  const headerValues: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(objectOrEmpty(body.headerValues))) {
    headerValues[name] = arrayOrEmpty(values).map(text);
  }
  return {
    id: text(body.id),
    threadId: text(body.threadId),
    labelIds: arrayOrEmpty(body.labelIds).map(text),
    internalDate: text(body.internalDate),
    headerValues,
    parts: arrayOrEmpty(body.parts).map((item) => {
      const part = asObject(item);
      return {
        index: count(part.index),
        mimeType: text(part.mimeType),
        filename: text(part.filename),
        size: text(part.size),
        hasAttachmentId: part.hasAttachmentId === true,
      };
    }),
  };
}

/**
 * Gmail reads kept on disk under `outDir`, so a repeated run in one session does not spend the
 * mailbox's quota again. One JSON line per read, appended as it lands, so a run that dies keeps
 * what it read. Its age is the file's first line's time, written into the run's watermarks.
 */
function gmailCache(config: LiveConfig): SourceCache & { readonly since: string | null } {
  const file = join(config.outDir, "gmail-cache.jsonl");
  const held = new Map<string, FullMessage | null>();
  let since: string | null = null;
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim().length > 0) {
        const entry = asObject(JSON.parse(line));
        since ??= text(entry.at);
        held.set(text(entry.key), cachedMessage(entry.message));
      }
    }
  }
  return {
    get since(): string | null {
      return since;
    },
    get: (key) => held.get(key),
    put: (key, message): void => {
      const at = new Date().toISOString();
      since ??= at;
      held.set(key, message);
      appendFileSync(file, `${JSON.stringify({ key, at, message })}\n`);
    },
  };
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
    undercroft: lakeReader(config, args.lakeCacheMinutes),
    google: { primary: client("primary"), secondary: client("secondary") },
  };
}

/** What the lake's data is as of, recorded before any comparison. */
async function watermarks(systems: Systems): Promise<Record<string, string>> {
  const marks: Record<string, string> = {};
  const summary = await systems.undercroft.summary();
  for (const stream of summary.records) {
    marks[`undercroft ${stream.source}/${stream.entity}`] =
      `${stream.records} records, latest observed ${stream.latestObservedAt}`;
  }
  systems.sink.json("watermarks", { undercroft: summary });
  return marks;
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

/** One live run: read Gmail and the lake, judge every case, write the run folder. */
export async function execute(args: Args, listener?: JudgedListener): Promise<Execution> {
  const config = loadConfig(args.config, resolve(import.meta.dir, "..", ".."));
  const started = new Date();
  const id = runId(started);
  const runDir = join(config.outDir, id);
  const opened = openSystems(config, runDir, args);
  const sourceCache = gmailCache(config);
  const systems = {
    ...opened,
    sourceCache,
    sink: withProgress(opened.sink, listener),
    progress: (line: string): void => {
      process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${line}\n`);
    },
  };
  const marks = await watermarks(systems);
  const results = await runGmailSuite(systems);
  for (const [name, at] of systems.undercroft.snapshots) {
    marks[`lake snapshot ${name}`] = at;
  }
  if (sourceCache.since !== null) {
    marks["gmail reads cached since"] = sourceCache.since;
  }
  const meta = {
    runId: id,
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    mode: "live" as const,
    sources: ["gmail"],
    watermarks: marks,
  };
  const { summaryPath } = writeRun(runDir, results, meta);
  return { runId: id, runDir, results, summaryPath, exitCode: summarise(results).exitCode };
}
