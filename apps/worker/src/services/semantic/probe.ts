/**
 * Ask a provider about a sample of real texts and keep what it cost and what it said.
 *
 * A MEASUREMENT, NOT THE FEATURE. Semantic fields will be a projection with its own schema, verb
 * and flow; which shape each of those takes depends on numbers nobody has yet -- how long a call
 * takes, what a text costs in tokens, whether asking three questions costs three times one,
 * what a long document does, how confident the answers are. This produces those numbers and
 * persists nothing, so no design is committed before they exist.
 *
 * TWO PASSES OVER ONE SAMPLE. Every text is asked the `single` questions; the first
 * `multiSample` of them are asked the `multi` questions too, in one more call each. Same texts
 * both times, so the difference between the passes is the questions and not the documents.
 *
 * NO TEXT LEAVES THIS MODULE. A `Call` carries the facts about its document and not the document:
 * `DocumentFacts` has no field that could hold a character of it, so a report built from calls
 * cannot quote a customer by construction rather than by care (`pii.md`).
 *
 * ONE CALL AT A TIME, deliberately. Latency measured under our own concurrency is our queueing
 * as much as the provider's speed, and the first question is the provider's speed.
 */

import {
  type Judgement,
  judge,
  type SemanticAsk,
  SemanticProviderError,
  type SemanticQuestions,
} from "./definition.ts";

/** What a measurement may know about a text without holding it. */
export interface DocumentFacts {
  readonly source: string;
  readonly documentId: string;
  /** How many documents share these bytes, and so this one answer. */
  readonly documents: number;
  /** Characters of the whole extracted text. */
  readonly chars: number;
  /** Less than the whole text was sent: this probe's cut, or the extractor's own ceiling. */
  readonly cut: boolean;
}

export interface ProbeDocument extends DocumentFacts {
  /** The text to send, already cut to the plan's `maxChars`. */
  readonly text: string;
}

export interface ProbePlan {
  readonly single: SemanticQuestions;
  readonly multi: SemanticQuestions;
  readonly multiSample: number;
}

export interface ProbeDeps {
  readonly ask: SemanticAsk;
  /** Milliseconds, monotonic. `performance.now` in production. */
  readonly clock: () => number;
}

export type Pass = "single" | "multi";

export type CallOutcome =
  | {
      readonly ok: true;
      readonly model: string;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly judgements: Readonly<Record<string, Judgement>>;
    }
  | { readonly ok: false; readonly reason: string };

export interface Call {
  readonly pass: Pass;
  readonly document: DocumentFacts;
  readonly ms: number;
  readonly outcome: CallOutcome;
}

function factsOf(document: ProbeDocument): DocumentFacts {
  return {
    source: document.source,
    documentId: document.documentId,
    documents: document.documents,
    chars: document.chars,
    cut: document.cut,
  };
}

async function askOnce(
  deps: ProbeDeps,
  pass: Pass,
  document: ProbeDocument,
  questions: SemanticQuestions,
): Promise<Call> {
  const started = deps.clock();
  try {
    const reply = await deps.ask(document.text, questions);
    const judgements: Record<string, Judgement> = {};
    for (const [name, definition] of Object.entries(questions)) {
      judgements[name] = judge(definition, reply.answers[name]);
    }
    return {
      pass,
      document: factsOf(document),
      ms: deps.clock() - started,
      outcome: {
        ok: true,
        model: reply.model,
        inputTokens: reply.inputTokens,
        outputTokens: reply.outputTokens,
        judgements,
      },
    };
  } catch (error) {
    // Only the adapter's own failure is a measurement. Anything else is a bug in this program,
    // and recording it as a provider outage would put our defect in the provider's column.
    if (!(error instanceof SemanticProviderError)) {
      throw error;
    }
    return {
      pass,
      document: factsOf(document),
      ms: deps.clock() - started,
      outcome: { ok: false, reason: error.reason },
    };
  }
}

/** Run both passes, one call at a time. A failed call is a row, not the end of the run. */
export async function runProbe(
  deps: ProbeDeps,
  documents: readonly ProbeDocument[],
  plan: ProbePlan,
): Promise<Call[]> {
  const calls: Call[] = [];
  for (const document of documents) {
    calls.push(await askOnce(deps, "single", document, plan.single));
  }
  for (const document of documents.slice(0, plan.multiSample)) {
    calls.push(await askOnce(deps, "multi", document, plan.multi));
  }
  return calls;
}
