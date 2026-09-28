/**
 * A semantic question over a text, what a provider answered, and whether the answer is one the
 * question allowed.
 *
 * PROVIDER-NEUTRAL ON PURPOSE. The first provider is TypeSafe's Jev, reached through
 * `@typesafe-ai/sdk`, but nothing here names it: the adapter at the composition root turns a
 * definition into the SDK's question and the SDK's response into a `ProviderAnswer`, the same
 * split `apps/control-plane/src/main.ts` keeps for the assistant's injection gate. A second
 * provider is a second adapter, and nothing downstream of this module learns it happened.
 *
 * THE SHAPES FOLLOW WHAT JEV ACTUALLY RETURNS, verified against the SDK's own types (0.6.0):
 *
 * - a choice comes back as a label, a confidence and a probability for EVERY label, so the
 *   runner-up is known and a threshold can be moved later without asking again;
 * - a yes/no question comes back as ONE probability and nothing else. There is no separate
 *   verdict and no separate confidence, so this module does not invent them: turning 0.54 into
 *   `true` is exactly the guess `money.md`'s "never guess" forbids;
 * - a score is asked with a RUBRIC -- at least two described levels, indexed from zero -- not
 *   a minimum and a maximum, and comes back as an expected level that may fall between two.
 *
 * `judge` IS THE CONTRACT CHECK. A provider that names a label the question never offered, or a
 * probability outside [0, 1], has answered a different question. That answer is recorded with
 * its reason and never passed on as a value, because a label nobody allowed looks exactly like
 * one somebody did once it is in a table.
 */

export type SemanticDefinition =
  | {
      readonly kind: "choice";
      readonly instruction: string;
      /** Label to what it means. The label is the value; the description only guides. */
      readonly choices: Readonly<Record<string, string>>;
    }
  | { readonly kind: "boolean"; readonly instruction: string }
  | {
      readonly kind: "score";
      readonly instruction: string;
      /** What each level means, from level 0 upward. */
      readonly rubric: readonly [string, string, ...string[]];
    };

/** Named questions asked of one text together. */
export type SemanticQuestions = Readonly<Record<string, SemanticDefinition>>;

export type ProviderAnswer =
  | {
      readonly kind: "choice";
      readonly label: string;
      readonly confidence: number;
      readonly probabilities: Readonly<Record<string, number>>;
    }
  | { readonly kind: "boolean"; readonly probability: number }
  | { readonly kind: "score"; readonly score: number; readonly confidence: number };

/** One call's answers, with what the call cost and which model gave it. */
export interface ProviderReply {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly answers: Readonly<Record<string, ProviderAnswer | undefined>>;
}

/** Ask every question about one text. Throws `SemanticProviderError` when the provider fails. */
export type SemanticAsk = (text: string, questions: SemanticQuestions) => Promise<ProviderReply>;

/**
 * The provider could not answer at all, with a reason that carries no text.
 *
 * `reason` is a fixed vocabulary the adapter chooses (`http-429`, `timeout`, `connection`), never
 * the provider's own message: that is arbitrary text, and it may quote the input back.
 */
export class SemanticProviderError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`semantic provider failed: ${reason}`);
    this.name = "SemanticProviderError";
    this.reason = reason;
  }
}

export type Judgement =
  | { readonly status: "classified"; readonly answer: ProviderAnswer }
  | { readonly status: "invalid-response"; readonly reason: string };

function isProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

type ChoiceAnswer = ProviderAnswer & { readonly kind: "choice" };
type ScoreAnswer = ProviderAnswer & { readonly kind: "score" };

function invalid(reason: string): Judgement {
  return { status: "invalid-response", reason };
}

/** Every number that claims to be a probability is one, or the answer is refused. */
function probabilitiesHold(answer: ProviderAnswer, numbers: readonly number[]): Judgement {
  return numbers.every(isProbability)
    ? { status: "classified", answer }
    : invalid("probability-out-of-range");
}

function judgeChoice(choices: Readonly<Record<string, string>>, answer: ChoiceAnswer): Judgement {
  if (!Object.hasOwn(choices, answer.label)) {
    return invalid("label-not-offered");
  }
  return probabilitiesHold(answer, [answer.confidence, ...Object.values(answer.probabilities)]);
}

function judgeScore(rubric: readonly string[], answer: ScoreAnswer): Judgement {
  const top = rubric.length - 1;
  if (!(Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= top)) {
    return invalid("score-out-of-range");
  }
  return probabilitiesHold(answer, [answer.confidence]);
}

/** Accept an answer only if it is one `definition` allowed. */
export function judge(
  definition: SemanticDefinition,
  answer: ProviderAnswer | undefined,
): Judgement {
  if (answer === undefined) {
    return invalid("no-answer");
  }
  if (definition.kind === "choice" && answer.kind === "choice") {
    return judgeChoice(definition.choices, answer);
  }
  if (definition.kind === "score" && answer.kind === "score") {
    return judgeScore(definition.rubric, answer);
  }
  if (definition.kind === "boolean" && answer.kind === "boolean") {
    return probabilitiesHold(answer, [answer.probability]);
  }
  return invalid("wrong-kind");
}

/** The most likely label other than the one chosen, with its probability. */
export function runnerUp(answer: ChoiceAnswer): readonly [string, number] | null {
  const others = Object.entries(answer.probabilities).filter(([label]) => label !== answer.label);
  return others.sort((a, b) => b[1] - a[1])[0] ?? null;
}
