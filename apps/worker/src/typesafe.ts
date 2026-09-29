/**
 * The TypeSafe (Jev) adapter: a provider-neutral `SemanticAsk` over `@typesafe-ai/sdk`.
 *
 * AT THE COMPOSITION ROOT, where every vendor's surface lives (`layering.md`): `server.ts` and
 * `semanticProbeCli.ts` build a client and hand this function's answer down; nothing below them
 * names the SDK. `services/semantic/definition.ts` records the shapes and why they are what Jev
 * actually returns. A second provider is a second file like this one.
 */

import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  choice,
  noul,
  type Question,
  type ResultFor,
  score,
  type TypeSafeClient,
} from "@typesafe-ai/sdk";

import {
  type ProviderAnswer,
  type SemanticAsk,
  type SemanticDefinition,
  SemanticProviderError,
} from "./services/semantic/definition.ts";

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
export function typesafeAsk(client: TypeSafeClient, model: string | undefined): SemanticAsk {
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
