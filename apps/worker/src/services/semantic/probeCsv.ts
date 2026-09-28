/**
 * The probe's spot-check sheet: one row per question per call, with the document id and the
 * answer, so a person can open the document and say whether the answer was right. That is the
 * accuracy half `probeReport.ts` cannot have.
 *
 * Ids and answers, never text: it is built from `Call`, which has none to give (`probe.ts`).
 */

import { type ProviderAnswer, runnerUp, type SemanticQuestions } from "./definition.ts";
import type { Call, Pass } from "./probe.ts";

const HEADER = [
  "pass",
  "question",
  "source",
  "document_id",
  "documents",
  "chars",
  "cut",
  "ms",
  "status",
  "value",
  "confidence",
  "runner_up",
  "runner_up_probability",
] as const;

const NEEDS_QUOTING = /[",\n]/u;

function field(value: string): string {
  return NEEDS_QUOTING.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function answerFields(answer: ProviderAnswer): [string, string, string, string] {
  switch (answer.kind) {
    case "choice": {
      const second = runnerUp(answer);
      return [
        answer.label,
        answer.confidence.toFixed(4),
        second?.[0] ?? "",
        second?.[1].toFixed(4) ?? "",
      ];
    }
    case "boolean":
      // The probability IS the answer; there is no verdict to put beside it.
      return [answer.probability.toFixed(4), "", "", ""];
    case "score":
      return [answer.score.toFixed(2), answer.confidence.toFixed(4), "", ""];
    default:
      return ["", "", "", ""];
  }
}

function outcomeFields(call: Call, name: string): string[] {
  if (call.outcome.ok) {
    const judgement = call.outcome.judgements[name];
    return judgement?.status === "classified"
      ? ["classified", ...answerFields(judgement.answer)]
      : [`invalid-response:${judgement?.reason ?? "no-answer"}`, "", "", "", ""];
  }
  return [`provider-error:${call.outcome.reason}`, "", "", "", ""];
}

export function renderProbeCsv(
  calls: readonly Call[],
  questions: { readonly [P in Pass]: SemanticQuestions },
): string {
  const rows = [HEADER.join(",")];
  for (const call of calls) {
    const facts = [
      call.document.source,
      call.document.documentId,
      String(call.document.documents),
      String(call.document.chars),
      String(call.document.cut),
      call.ms.toFixed(0),
    ];
    for (const name of Object.keys(questions[call.pass])) {
      rows.push([call.pass, name, ...facts, ...outcomeFields(call, name)].map(field).join(","));
    }
  }
  return `${rows.join("\n")}\n`;
}
