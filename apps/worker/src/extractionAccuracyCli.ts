/**
 * Measure whether the extractors are right, and print what could not be measured.
 *
 *   task db:extract-accuracy
 *
 * WHY A CLI AND NOT A GATE. `scripts/wikiCoverage.ts` answers a question with one true answer
 * and fails the build on the wrong one; this answers with a percentage, and a percentage has
 * no build-failing side. The part that CAN be asserted -- that the measurement tells the truth
 * about itself -- rides `bun test` from the four suites beside
 * `services/extract/accuracy.ts`, which is where a regression should surface. What this adds
 * is the two halves a suite cannot have: the real corpus, and a readable report.
 *
 * WHY IT LIVES BESIDE `migrateCli.ts` AND `inviteCli.ts` RATHER THAN IN `scripts/`. Those are
 * the two commands in this repo that need a DSN, and both sit at a composition root for the
 * reason this one does. `scripts/` is outside the bun workspace, so nothing there can import
 * `@undercroft/worker` at all -- measured, not assumed -- and a measurement that cannot reach
 * the shipped readers would be measuring a copy of them. Law 9 applies to a measurement
 * harness before it applies to anything else. The SHAPE is still `wikiCoverage`'s: pure
 * modules, sibling suites that assert, and an entry point for the person who wants the list
 * rather than an assertion diff.
 *
 * IT DEGRADES RATHER THAN PRETENDING. No DSN is a corpus section that says so; no object store
 * is an oracle section that says so; a machine without poppler scores OCR as UNMEASURED and
 * not as zero. Each of those becomes a line in the report's own last section, because a number
 * whose conditions travelled separately is a number the next reader will misread.
 *
 * WHAT IT WRITES is counts and rates, to `data/`, which is gitignored. Nothing it prints is a
 * character of a customer's document or an id pointing at one. `data/` even so: a measurement
 * taken over a customer's corpus is not a repository artefact, whatever it is made of.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

import { asExecutor, createPool } from "@undercroft/db";
import { LakeStore, S3ObjectStore } from "@undercroft/lake";

import { type ExtractionScan, scanExtractions } from "./repos/documentText.ts";
import { type Gap, type GoldScore, scoreGold } from "./services/extract/accuracy.ts";
import { type AccuracyRun, renderReport } from "./services/extract/accuracyReport.ts";
import { type CorpusReport, measureCorpus } from "./services/extract/corpusSignals.ts";
import { GOLD_SET } from "./services/extract/goldSet.ts";
import {
  ooxmlRecall,
  type OoxmlRecall,
  type RecallSummary,
  summariseRecall,
} from "./services/extract/ooxmlOracle.ts";
import { realSpawn } from "./services/transform.ts";

/**
 * How much of the corpus one run reads.
 *
 * Every row carries a whole document's text, so this is a memory budget as much as a sample
 * size: two thousand contracts is comfortably inside a worker's limit and is more than the
 * whole catalogue on production today. A run that reaches the cap says so in the report -- a
 * rate over a capped sample is conditional on the cap, and the reader has to be told.
 */
const CORPUS_SAMPLE = 2000;

/**
 * And how many OOXML documents the oracle fetches bytes for.
 *
 * Far smaller, because each one is a round trip to the object store -- and sampled separately
 * because the two types are a minority of the catalogue, so a uniform sample would answer the
 * strongest question in the measurement with a handful of documents. Law 3: a rare case needs
 * targeted sampling.
 */
const OOXML_SAMPLE = 200;

const OOXML_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

/** The corpus halves, or the reason there are none. Never a zero standing in for either. */
interface Corpus {
  readonly report: CorpusReport | null;
  readonly capped: boolean;
  readonly recall: RecallSummary | null;
  readonly gaps: readonly Gap[];
}

const NO_DATABASE: Corpus = {
  report: null,
  capped: false,
  recall: null,
  gaps: [
    {
      what: "everything about the real corpus",
      why: "UNDERCROFT_POSTGRES_DSN is unset, so no extraction was read. Tier A says what the readers do to documents we wrote, and nothing about the documents customers sent.",
    },
  ],
};

/**
 * The database was named and could not be read.
 *
 * A gap rather than a crash, and that is the whole of `IT DEGRADES RATHER THAN PRETENDING`
 * above: tier A has already been computed by this point, and losing a measurement that ran
 * because a second one could not reach its server is the opposite of what this command is for.
 *
 * THE ERROR ITSELF GOES TO STDERR AND NOT INTO THE REPORT. A driver's message is arbitrary
 * text -- a host, a port, a role name -- and the report is a file. `migrateCli.ts` writes its
 * failures to stderr for the same reason, and the operator reading one is at a terminal.
 */
function corpusUnreadable(error: unknown): Corpus {
  process.stderr.write(
    `could not read the corpus: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  return {
    report: null,
    capped: false,
    recall: null,
    gaps: [
      {
        what: "everything about the real corpus",
        why: "the database named by UNDERCROFT_POSTGRES_DSN could not be read. The reason was written to stderr rather than here, because a driver's message is arbitrary text and this is a file.",
      },
    ],
  };
}

const NO_OBJECT_STORE: Gap = {
  what: "recall of real OOXML documents",
  why: "the oracle needs each document's own bytes and no object store is configured. Set UNDERCROFT_S3_BUCKET_RAW and its credentials.",
};

/** The lake, if this process was given one. `null` rather than a half-configured store. */
function openLake(): LakeStore | null {
  const bucket = process.env.UNDERCROFT_S3_BUCKET_RAW;
  if (bucket === undefined || bucket === "") {
    return null;
  }
  const endpoint = process.env.UNDERCROFT_S3_ENDPOINT;
  const accessKeyId = process.env.UNDERCROFT_S3_ACCESS_KEY;
  const secretAccessKey = process.env.UNDERCROFT_S3_SECRET_KEY;
  return new LakeStore(
    new S3ObjectStore({
      bucket,
      ...(endpoint === undefined ? {} : { endpoint }),
      ...(accessKeyId !== undefined && secretAccessKey !== undefined
        ? { accessKeyId, secretAccessKey }
        : {}),
    }),
  );
}

/** Score a sample of OOXML documents against what their own parts declare. */
async function runOracle(
  lake: LakeStore,
  sample: readonly ExtractionScan[],
): Promise<{ recall: RecallSummary; gaps: Gap[] }> {
  const results: (OoxmlRecall | null)[] = [];
  let unreadable = 0;

  for (const row of sample) {
    try {
      results.push(ooxmlRecall(await lake.read(row.lakeKey), row.text));
    } catch {
      // The catalogue says the bytes are there and the lake disagrees. Counted, not scored: a
      // document nobody could fetch is not a document a reader got wrong.
      unreadable += 1;
    }
  }

  return {
    recall: summariseRecall(results),
    gaps:
      unreadable === 0
        ? []
        : [
            {
              what: `${unreadable} OOXML documents the object store could not return`,
              why: "their bytes were not fetchable, so the oracle has no opinion about them either way.",
            },
          ],
  };
}

async function readCorpus(dsn: string): Promise<Corpus> {
  const pool = createPool(dsn);
  try {
    const exec = asExecutor(pool);
    const rows = await scanExtractions(exec, { limit: CORPUS_SAMPLE, contentTypes: [] });
    const shared = { report: measureCorpus(rows), capped: rows.length === CORPUS_SAMPLE };

    const lake = openLake();
    if (lake === null) {
      return { ...shared, recall: null, gaps: [NO_OBJECT_STORE] };
    }

    const sample = await scanExtractions(exec, {
      limit: OOXML_SAMPLE,
      contentTypes: OOXML_TYPES,
    });
    return { ...shared, ...(await runOracle(lake, sample)) };
  } finally {
    await pool.end();
  }
}

/**
 * The child environment the native readers inherit, with the unset variables dropped.
 *
 * `PATH` is the load-bearing part: without it `Bun.spawn` cannot find `pdftotext` even on a
 * machine that has it, and every PDF case would report the binary missing and score
 * UNMEASURED. Copied rather than asserted, because `process.env` admits `undefined` values and
 * a cast that claimed otherwise would be a lie about a variable somebody forgot to set.
 */
function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
}

/** Tier A, in a scratch directory the native readers can open a file from. */
async function runGoldSet(): Promise<GoldScore> {
  const workDir = await mkdtemp(join(tmpdir(), "extraction-accuracy-"));
  try {
    return await scoreGold({ spawn: realSpawn, workDir, env: childEnv() }, GOLD_SET);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const gold = await runGoldSet();
  const dsn = process.env.UNDERCROFT_POSTGRES_DSN;
  const corpus =
    dsn === undefined || dsn === "" ? NO_DATABASE : await readCorpus(dsn).catch(corpusUnreadable);

  const at = new Date().toISOString();
  const run: AccuracyRun = {
    at,
    gold,
    corpus: corpus.report,
    corpusCapped: corpus.capped,
    recall: corpus.recall,
    gaps: corpus.gaps,
  };
  const report = renderReport(run);
  process.stdout.write(report);

  const directory = resolve(import.meta.dirname, "../../..", "data");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `extraction-accuracy-${at.replaceAll(":", "-")}.txt`);
  await writeFile(path, report);
  process.stdout.write(`\nwritten to ${path}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
