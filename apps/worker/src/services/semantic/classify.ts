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
 * WRITTEN AS IT GOES, in small batches. A deploy stops the worker, and on the day this was written
 * four deploys in an hour each stopped a long run; answers held in memory until the end would be
 * paid for and lost every time. A batch written is an answer kept, and the next run asks only what
 * is still due. The stop signal is honoured between two texts.
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

/** Shorter than this is not a document worth a call. */
export const MIN_CHARS = 60;
/** How much of a text is sent. */
export const MAX_CHARS = 32_000;
/** Texts per run; the flow's next tick takes the rest. */
export const DEFAULT_BATCH = 500;
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
  let stopped = false;

  for (const text of texts) {
    if (deps.stop?.aborted === true) {
      stopped = true;
      break;
    }
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
  }
  await upsertKindResults(deps.exec, scope.tenantId, stamp, pending.splice(0));
  return { ...tally, stopped };
}
