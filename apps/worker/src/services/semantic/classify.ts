/**
 * One classifying pass over a (tenant, source) pair's due texts. ADR 0085.
 *
 * WHAT IT ASKS is the tenant's current published catalogue, exactly as published: the instruction,
 * and every kind with the description the admin approved, as one choice question. The answer is
 * judged against that catalogue (`judge`), so a label it never offered is `invalid-response` and
 * never a value.
 *
 * WHAT IT DOES NOT ASK. A text under `MIN_CHARS` is recorded `too-short` without a call: those are
 * almost all logos and signatures OCR read out of mail, and a confident label on "BANK napas 24 QR"
 * is a guess with a number on it. Only the first `MAX_CHARS` of a text are sent -- measured on
 * `tai-001`, where 32,000 characters were answered in under half a second.
 *
 * SEVERAL TEXTS AT ONCE, `IN_FLIGHT` of them (ADR 0102). The provider bills per call and allows
 * far more than one in flight; asking one text at a time used about 5% of that and made a first
 * classification take two days of ticks for no saving. Six, because the worker runs two semantic
 * runs at once by default (`UNDERCROFT_MAX_CONCURRENT_SEMANTIC`), and twelve calls of ~0.5 s and
 * ~3,000 tokens stay well under 40 requests and 100K tokens a second -- limits the provider says
 * it moves. A 429 that outlives the SDK's own retries is a `provider-error` row, asked again.
 *
 * WRITTEN AS IT GOES, in small batches. A deploy stops the worker, and on the day this was written
 * four deploys in an hour each stopped a long run; answers held in memory until the end would be
 * paid for and lost every time. A batch written is an answer kept, and the next run asks only what
 * is still due. A stop starts no new call; the calls already in flight finish and are written.
 *
 * A PROVIDER ERROR IS A ROW, NOT A FAILED RUN: it says why, and the due predicate asks it again.
 */

import {
  type KindResult,
  type KindStatus,
  type SemanticScope,
  upsertKindResults,
  dueTexts,
} from "../../repos/documentKindResults.ts";
import type { SqlExecutor } from "@undercroft/db";
import { judge, type SemanticAsk, SemanticProviderError } from "./definition.ts";
import { inFlight } from "./inFlight.ts";

/** Shorter than this is not a document worth a call. */
export const MIN_CHARS = 60;
/** How much of a text is sent. */
export const MAX_CHARS = 32_000;
/** Texts per run; the flow's next tick takes the rest. About four minutes at `IN_FLIGHT`. */
export const DEFAULT_BATCH = 3000;
/** Calls waiting on the provider at once, per run. */
export const IN_FLIGHT = 6;
/** Answers per write: small enough that a stop loses little, large enough to be one statement. */
const WRITE_EVERY = 25;

export interface ClassifyDeps {
  readonly exec: SqlExecutor;
  readonly ask: SemanticAsk;
  readonly stop?: AbortSignal;
  readonly batch?: number;
  /** Called after each text, for the run's gauge. */
  readonly progress?: (done: number, total: number) => void;
}

/** The published definition a run classifies against, as it was stored. */
export interface Catalogue {
  readonly version: number;
  readonly definitionHash: string;
  readonly model: string;
  readonly instruction: string;
  readonly kinds: Readonly<Record<string, string>>;
}

export interface ClassifyTally {
  readonly asked: number;
  readonly classified: number;
  readonly tooShort: number;
  readonly invalid: number;
  readonly providerErrors: number;
  /** A stop arrived before the batch was done. */
  readonly stopped: boolean;
}

const QUESTION = "document_kind";

function fourPlaces(value: number): string {
  return value.toFixed(4);
}

async function answerOne(
  deps: ClassifyDeps,
  catalogue: Catalogue,
  text: { digest: string; chars: number; text: string },
): Promise<KindResult> {
  const blank = { digest: text.digest, kind: null, confidence: null, probabilities: null };
  if (text.chars < MIN_CHARS) {
    return { ...blank, status: "too-short", reason: `under ${String(MIN_CHARS)} characters` };
  }
  const definition = {
    kind: "choice" as const,
    instruction: catalogue.instruction,
    choices: catalogue.kinds,
  };
  try {
    const reply = await deps.ask(text.text, { [QUESTION]: definition });
    const judged = judge(definition, reply.answers[QUESTION]);
    if (judged.status === "invalid-response" || judged.answer.kind !== "choice") {
      const reason = judged.status === "invalid-response" ? judged.reason : "wrong-kind";
      return { ...blank, status: "invalid-response", reason };
    }
    const { answer } = judged;
    return {
      digest: text.digest,
      status: "classified",
      kind: answer.label,
      confidence: fourPlaces(answer.confidence),
      probabilities: Object.fromEntries(
        Object.entries(answer.probabilities).map(([label, p]) => [label, fourPlaces(p)]),
      ),
      reason: null,
    };
  } catch (error) {
    // Only the adapter's own failure is an answer to record. Anything else is a defect here,
    // and writing it as the provider's would hide it.
    if (!(error instanceof SemanticProviderError)) {
      throw error;
    }
    return { ...blank, status: "provider-error", reason: error.reason };
  }
}

type Counts = Omit<ClassifyTally, "stopped">;

const COUNTED: Readonly<Record<KindStatus, keyof Counts>> = {
  classified: "classified",
  "too-short": "tooShort",
  "invalid-response": "invalid",
  "provider-error": "providerErrors",
};

/** Every status but `too-short` cost a call to the classifier. */
function count(tally: { -readonly [K in keyof Counts]: number }, status: KindStatus): void {
  tally[COUNTED[status]] += 1;
  tally.asked += status === "too-short" ? 0 : 1;
}

export async function classifyPass(
  deps: ClassifyDeps,
  scope: SemanticScope,
  catalogue: Catalogue,
  runId: string,
): Promise<ClassifyTally> {
  const texts = await dueTexts(deps.exec, scope, {
    limit: deps.batch ?? DEFAULT_BATCH,
    maxChars: MAX_CHARS,
  });
  const stamp = {
    definitionHash: catalogue.definitionHash,
    version: catalogue.version,
    model: catalogue.model,
    runId,
  };
  const pending: KindResult[] = [];
  const tally = { asked: 0, classified: 0, tooShort: 0, invalid: 0, providerErrors: 0 };

  const { stopped } = await inFlight(
    texts,
    IN_FLIGHT,
    async (text) => {
      const result = await answerOne(deps, catalogue, text);
      count(tally, result.status);
      pending.push(result);
      if (pending.length >= WRITE_EVERY) {
        await upsertKindResults(deps.exec, scope.tenantId, stamp, pending.splice(0));
      }
      deps.progress?.(
        tally.classified + tally.tooShort + tally.invalid + tally.providerErrors,
        texts.length,
      );
    },
    deps.stop,
  );
  await upsertKindResults(deps.exec, scope.tenantId, stamp, pending.splice(0));
  return { ...tally, stopped };
}
