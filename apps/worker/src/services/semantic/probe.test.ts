/**
 * The semantic probe: what it records when a provider answers, answers wrongly, or fails, and
 * that what it writes down never carries the documents it asked about.
 *
 * The provider is an in-memory table keyed by the text it is asked about, and it REFUSES a text
 * it was not given -- the `InMemoryFetcher` idiom -- so a probe that sent the wrong text fails
 * here instead of being answered by a fake that always agrees.
 */

import { describe, expect, test as it } from "bun:test";

import {
  type ProviderReply,
  type SemanticAsk,
  SemanticProviderError,
  type SemanticQuestions,
} from "./definition.ts";
import { type ProbeDeps, type ProbeDocument, type ProbePlan, runProbe } from "./probe.ts";
import { renderProbeCsv } from "./probeCsv.ts";
import { renderProbeReport } from "./probeReport.ts";

const QUESTIONS: SemanticQuestions = {
  document_type: {
    kind: "choice",
    instruction: "Classify the primary type of this document.",
    choices: { invoice: "A bill.", contract: "An agreement." },
  },
};

const PLAN: ProbePlan = { single: QUESTIONS, multi: QUESTIONS, multiSample: 0 };

function document(documentId: string, text: string): ProbeDocument {
  return { source: "drive", documentId, documents: 1, chars: text.length, cut: false, text };
}

function chose(label: string, confidence: number): ProviderReply {
  return {
    model: "test-model",
    inputTokens: 100,
    outputTokens: 5,
    answers: {
      document_type: {
        kind: "choice",
        label,
        confidence,
        probabilities: { invoice: confidence, contract: 1 - confidence },
      },
    },
  };
}

/** Answers exactly the texts it was given, and refuses any other. */
function provider(
  replies: Readonly<Record<string, ProviderReply | SemanticProviderError>>,
): SemanticAsk {
  return (text) => {
    const reply = replies[text];
    if (reply === undefined) {
      return Promise.reject(new Error(`unmodelled text: ${text}`));
    }
    return reply instanceof SemanticProviderError ? Promise.reject(reply) : Promise.resolve(reply);
  };
}

function deps(ask: SemanticAsk): ProbeDeps {
  return { ask, clock: () => 0 };
}

describe("runProbe", () => {
  it("keeps an offered label as the answer", async () => {
    const [call] = await runProbe(
      deps(provider({ "Please pay invoice 7": chose("invoice", 0.97) })),
      [document("d1", "Please pay invoice 7")],
      PLAN,
    );

    expect(call?.outcome).toMatchObject({
      ok: true,
      judgements: { document_type: { status: "classified", answer: { label: "invoice" } } },
    });
  });

  it("refuses a label the question never offered instead of recording it as the answer", async () => {
    const [call] = await runProbe(
      deps(provider({ "Please pay invoice 7": chose("receipt", 0.97) })),
      [document("d1", "Please pay invoice 7")],
      PLAN,
    );

    expect(call?.outcome).toMatchObject({
      ok: true,
      judgements: { document_type: { status: "invalid-response", reason: "label-not-offered" } },
    });
  });

  it("records a provider failure with its reason and still asks about the next text", async () => {
    const calls = await runProbe(
      deps(
        provider({
          "first text": new SemanticProviderError("http-429"),
          "second text": chose("contract", 0.2),
        }),
      ),
      [document("d1", "first text"), document("d2", "second text")],
      PLAN,
    );

    expect(calls.map((call) => call.outcome.ok)).toEqual([false, true]);
    expect(calls[0]?.outcome).toEqual({ ok: false, reason: "http-429" });
  });
});

describe("the probe's report", () => {
  it("counts only the answers at or above the proposed threshold as sure", async () => {
    const texts = {
      a: chose("invoice", 0.95),
      b: chose("invoice", 0.9),
      c: chose("contract", 0.2),
    };
    const calls = await runProbe(
      deps(provider(texts)),
      Object.keys(texts).map((text) => document(text, text)),
      PLAN,
    );

    const report = renderProbeReport({
      at: "2026-09-28T00:00:00.000Z",
      tenantId: "CASE-0042",
      maxChars: 32_000,
      catalogue: { digests: 3, documents: 3, cutChars: 3 },
      ...PLAN,
      calls,
    });

    expect(report).toContain("at ≥ 0.9: 2 of 3 (66.7%)");
  });

  it("writes neither the summary nor the spot-check sheet with any of the documents' text", async () => {
    const secret = "Acme owes 4,200,000 VND under contract 99";
    const calls = await runProbe(
      deps(provider({ [secret]: chose("contract", 0.99) })),
      [document("d1", secret)],
      { ...PLAN, multiSample: 1 },
    );

    const written = [
      renderProbeReport({
        at: "2026-09-28T00:00:00.000Z",
        tenantId: "CASE-0042",
        maxChars: 32_000,
        catalogue: { digests: 1, documents: 1, cutChars: secret.length },
        ...PLAN,
        calls,
      }),
      renderProbeCsv(calls, PLAN),
    ].join("\n");

    expect(written).toContain("d1");
    expect(written).not.toContain("Acme");
  });
});
