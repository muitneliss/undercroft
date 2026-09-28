/**
 * Ask Jev about a sample of one tenant's real documents, and report what it cost and said.
 *
 *   UNDERCROFT_POSTGRES_DSN=... UNDERCROFT_TYPESAFE_API_KEY=... \
 *     task db:semantic-probe -- --tenant CASE-0042 [--limit 200] [--multi 50] [--max-chars 32000]
 *
 * WHY IT EXISTS BEFORE THE FEATURE. Semantic fields -- a typed, confidence-carrying answer
 * derived from a document's text and kept as a rebuildable projection -- need a schema, a worker
 * verb and a flow, and every one of those turns on numbers nobody has: latency, tokens per text,
 * the cost of asking several questions at once, what a long document does, and how confident the
 * answers are on this corpus. `services/semantic/probe.ts` says what it measures and why.
 *
 * WHY IT LIVES HERE AND NOT IN `scripts/`: the reason `extractionAccuracyCli.ts` gives. It reads
 * `raw.document_text` through the worker's own repo, as the role that may read the `text`
 * column, and `scripts/` cannot import the worker at all.
 *
 * THIS SENDS A CUSTOMER'S TEXT TO A THIRD PARTY. It is run by a person who has decided that is
 * permitted for the tenant they name, and it is bounded: `--limit` distinct texts, at most
 * `MAX_LIMIT`, each cut to `--max-chars`. The SDK logs at `error` only, because its `debug`
 * level logs request bodies -- which here are the documents.
 *
 * WHAT IT WRITES goes to `data/` (gitignored): the summary, and a CSV of document ids with the
 * answers for checking by hand. Never a character of a document. `data/` even for the summary,
 * for `extractionAccuracyCli.ts`'s reason: a measurement over a customer's corpus is not a
 * repository artefact.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  choice,
  noul,
  type Question,
  type ResultFor,
  score,
  TypeSafeClient,
} from "@typesafe-ai/sdk";
import { asExecutor, createPool } from "@undercroft/db";

import { type DigestTotals, sampleTextByDigest, totalTextByDigest } from "./repos/documentText.ts";
import {
  type ProviderAnswer,
  type SemanticAsk,
  type SemanticDefinition,
  SemanticProviderError,
  type SemanticQuestions,
} from "./services/semantic/definition.ts";
import { type ProbeDocument, type ProbePlan, runProbe } from "./services/semantic/probe.ts";
import { renderProbeCsv } from "./services/semantic/probeCsv.ts";
import { renderProbeReport } from "./services/semantic/probeReport.ts";

/** The most texts one run may send, whatever `--limit` says: a mistyped zero is not a bill. */
const MAX_LIMIT = 2000;

/**
 * Per attempt. The SDK's default is 10 s, which a long document may honestly need more than;
 * a call that takes longer than this is reported as `timeout`, which is itself a finding.
 */
const CALL_TIMEOUT_MS = 60_000;

/** The document-type question from the design notes: the first semantic field worth having. */
const DOCUMENT_TYPE: SemanticDefinition = {
  kind: "choice",
  instruction: "Classify the primary type of this document.",
  choices: {
    invoice: "A bill asking for payment for goods or services.",
    contract: "An agreement setting out obligations between parties.",
    receipt: "A record that a payment was received.",
    report: "An account of findings, figures or activity.",
    correspondence: "A letter, memo or message addressed to someone.",
    other: "None of the above.",
  },
};

/**
 * Three questions of three kinds, asked in ONE call: what batching by text would cost.
 *
 * `language` because this corpus is Vietnamese and English and a model's confidence may differ
 * between them; `legibility` because extraction includes OCR, and a garbled text answered with
 * confidence is the failure a threshold would have to catch.
 */
const MULTI: SemanticQuestions = {
  document_type: DOCUMENT_TYPE,
  language: {
    kind: "choice",
    instruction: "Which language is this document mainly written in?",
    choices: {
      vietnamese: "Mainly Vietnamese.",
      english: "Mainly English.",
      mixed: "Substantial parts in both Vietnamese and English.",
      other: "Mainly another language.",
    },
  },
  payment_requested: {
    kind: "boolean",
    instruction: "Does this document ask the reader to pay an amount of money?",
  },
  legibility: {
    kind: "score",
    instruction: "How readable is this text as a document?",
    rubric: [
      "Unreadable: mostly garbled characters or OCR noise.",
      "Partly readable: the meaning can be recovered only with effort.",
      "Readable, with some noise.",
      "Clean, fully readable text.",
    ],
  },
};

function toQuestion(definition: SemanticDefinition): Question {
  switch (definition.kind) {
    case "choice":
      return choice(definition.instruction, definition.choices);
    case "boolean":
      return noul(definition.instruction);
    case "score":
      return score(definition.instruction, definition.rubric);
    default:
      throw new Error("unknown semantic kind");
  }
}

function fromResult(result: ResultFor<Question>): ProviderAnswer {
  switch (result.type) {
    case "choice":
      return {
        kind: "choice",
        label: result.choice,
        confidence: result.confidence,
        probabilities: result.probabilities,
      };
    case "noul":
      return { kind: "boolean", probability: result.noul };
    case "score":
      return { kind: "score", score: result.score, confidence: result.confidence };
    default:
      throw new Error("unknown answer type");
  }
}

/** A fixed word for why the call failed. Never the SDK's message: it can quote the input. */
function reasonOf(error: unknown): string {
  if (error instanceof APIError) {
    return `http-${error.status}`;
  }
  if (error instanceof APITimeoutError) {
    return "timeout";
  }
  if (error instanceof APIConnectionError) {
    return "connection";
  }
  return "sdk";
}

/** The vendor's surface, kept here as `main.ts` keeps it for the control plane. */
function typesafeAsk(client: TypeSafeClient, model: string | undefined): SemanticAsk {
  return async (text, questions) => {
    const asked: Record<string, Question> = {};
    for (const [name, definition] of Object.entries(questions)) {
      asked[name] = toQuestion(definition);
    }
    const result = await client
      .systemOne({ state: text, questions: asked, ...(model === undefined ? {} : { model }) })
      .catch((error: unknown) => {
        throw new SemanticProviderError(reasonOf(error));
      });
    const answers: Record<string, ProviderAnswer> = {};
    for (const [name, answer] of Object.entries(result.answers)) {
      answers[name] = fromResult(answer);
    }
    return {
      model: result.model,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      answers,
    };
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function positive(flag: string, value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${flag} must be a positive whole number`);
  }
  return parsed;
}

interface Options {
  readonly tenantId: string;
  readonly limit: number;
  readonly maxChars: number;
  readonly model: string | undefined;
  readonly plan: ProbePlan;
}

function readOptions(): Options {
  const { values } = parseArgs({
    options: {
      tenant: { type: "string" },
      limit: { type: "string" },
      multi: { type: "string" },
      "max-chars": { type: "string" },
      model: { type: "string" },
    },
  });
  if (values.tenant === undefined || values.tenant === "") {
    throw new Error("--tenant is required: the probe reads one tenant's documents and no other");
  }
  const limit = Math.min(positive("limit", values.limit, 200), MAX_LIMIT);
  return {
    tenantId: values.tenant,
    limit,
    maxChars: positive("max-chars", values["max-chars"], 32_000),
    model: values.model,
    plan: {
      single: { document_type: DOCUMENT_TYPE },
      multi: MULTI,
      multiSample: Math.min(positive("multi", values.multi, 50), limit),
    },
  };
}

/** The sample, and the whole it was drawn from. The pool is closed before any text is sent. */
async function readSample(
  options: Options,
): Promise<{ documents: ProbeDocument[]; catalogue: DigestTotals }> {
  const { tenantId, limit, maxChars } = options;
  const pool = createPool(required("UNDERCROFT_POSTGRES_DSN"));
  try {
    const exec = asExecutor(pool);
    const catalogue = await totalTextByDigest(exec, { tenantId, maxChars });
    const rows = await sampleTextByDigest(exec, { tenantId, limit, maxChars });
    const documents = rows.map((row) => ({
      source: row.source,
      documentId: row.documentId,
      documents: row.documents,
      chars: row.chars,
      cut: row.chars > maxChars || row.extractorTruncated,
      text: row.text,
    }));
    return { documents, catalogue };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const options = readOptions();
  const client = new TypeSafeClient({
    apiKey: required("UNDERCROFT_TYPESAFE_API_KEY"),
    logLevel: "error",
    timeout: CALL_TIMEOUT_MS,
    // Off, so every failure in the report is what the provider did to a first attempt rather
    // than what survived two retries. Production will retry; this is measuring why it must.
    retry: { maxRetries: 0 },
  });

  const { documents, catalogue } = await readSample(options);
  if (documents.length === 0) {
    throw new Error(`tenant ${options.tenantId} has no readable document text to ask about`);
  }
  process.stderr.write(
    `asking about ${documents.length} texts (${options.plan.multiSample} twice)...\n`,
  );
  const calls = await runProbe(
    { ask: typesafeAsk(client, options.model), clock: () => performance.now() },
    documents,
    options.plan,
  );

  const at = new Date().toISOString();
  const { tenantId, maxChars, plan } = options;
  const report = renderProbeReport({ at, tenantId, maxChars, catalogue, ...plan, calls });
  process.stdout.write(report);

  const directory = resolve(import.meta.dirname, "../../..", "data");
  await mkdir(directory, { recursive: true });
  const stem = join(directory, `semantic-probe-${at.replaceAll(":", "-")}`);
  await writeFile(`${stem}.txt`, report);
  await writeFile(`${stem}.csv`, renderProbeCsv(calls, plan));
  process.stdout.write(`\nwritten to ${stem}.txt and ${stem}.csv\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
