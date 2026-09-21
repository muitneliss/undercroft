/**
 * A language model that answers from a script, and REFUSES anything it has no script for.
 *
 * The refusal is the whole point, and it is why this exists instead of a mock.
 * `.claude/rules/tests.md`: "a fake that never refuses makes a broken boundary look fine." A
 * model that answered every prompt with "ok" would keep the suite green through a broken system
 * prompt, a tool that was never registered, or a transcript restored in the wrong order --
 * every failure this feature is most likely to have. So an unscripted prompt raises, naming
 * what it was asked and what it knows, exactly as `InMemoryFetcher` does for an HTTP route.
 *
 * It implements the provider spec DIRECTLY -- six members -- rather than wrapping the SDK's own
 * test double, so `streamText`, the tool loop and `stopWhen` are all genuinely under test and
 * only the token source is substituted.
 *
 * WHY v4 AND NOT v3. `ai@7`'s `LanguageModel` accepts `v4 | v3 | v2`, so a v3 double would
 * typecheck and run. It would also be a different shape from the one production uses:
 * `@ai-sdk/anthropic@4` declares `specificationVersion = "v4"`, whose `usage` and `finishReason`
 * are nested objects where v3's were flat. A double one version behind the real provider is a
 * suite that passes against a shape nothing ships.
 *
 * `doGenerate` is deliberately NOT implemented: nothing in this codebase calls it, and a
 * plausible implementation nobody exercises is a second definition of this model's behaviour
 * waiting to disagree with the first.
 */

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

/** What the model does when a prompt matches: speak, or call a tool. */
export type Step = { readonly say: string } | { readonly call: string; readonly input: unknown };

export interface Turn {
  /**
   * Matched case-insensitively as a SUBSTRING of the last user message.
   *
   * A substring rather than an exact string because a test names the thing it is about ("hoá
   * đơn") rather than restating a whole sentence, and an exact match would make every test
   * brittle against its own fixture's punctuation.
   */
  readonly when: string;
  /**
   * What the model does when `when` matches.
   *
   * NOT named `then`: an object with a `then` property is thenable, so `await`ing a `Turn` --
   * or a promise that happened to resolve to one -- would call it as a continuation and hand
   * back something else entirely. Biome's `noThenProperty` catches it, and it is right to.
   */
  readonly reply: readonly Step[];
}

/** Nothing is being counted; the field is required and a scripted model has no tokens. */
const NO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
} as const;

/** The text of the last thing the reader said, which is what a script matches on. */
function lastUserText(options: LanguageModelV4CallOptions): string {
  for (const message of [...options.prompt].reverse()) {
    if (message.role !== "user") {
      continue;
    }
    return message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(" ")
      .trim();
  }
  return "";
}

function partsFor(steps: readonly Step[]): LanguageModelV4StreamPart[] {
  const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
  let toolCalls = 0;

  for (const [index, step] of steps.entries()) {
    if ("say" in step) {
      const id = `t${index}`;
      // Four parts rather than one, with the text split into two deltas, because that is the
      // shape a real provider streams -- a test that only ever saw a single delta would not
      // notice the interleaf mishandling a partial one.
      const half = Math.ceil(step.say.length / 2);
      parts.push(
        { type: "text-start", id },
        { type: "text-delta", id, delta: step.say.slice(0, half) },
        { type: "text-delta", id, delta: step.say.slice(half) },
        { type: "text-end", id },
      );
      continue;
    }
    toolCalls += 1;
    parts.push({
      type: "tool-call",
      toolCallId: `call-${index}`,
      toolName: step.call,
      // A JSON STRING, not an object: that is what the provider spec carries at this level, and
      // passing the object would have the SDK parse `[object Object]`.
      input: JSON.stringify(step.input),
    });
  }

  parts.push({
    type: "finish",
    // `tool-calls` when the turn ended on one, so the SDK runs the tools and comes back for
    // another turn; `stop` otherwise. Getting this wrong is how a scripted tool call silently
    // never executes.
    finishReason: { unified: toolCalls > 0 ? "tool-calls" : "stop", raw: undefined },
    usage: NO_USAGE,
  });
  return parts;
}

export class UnscriptedPromptError extends Error {
  constructor(asked: string, known: readonly string[]) {
    const scripts = known.length === 0 ? "(nothing scripted)" : known.join("\n  ");
    super(`no scripted turn matches:\n  ${asked}\nscripted matchers:\n  ${scripts}`);
    this.name = "UnscriptedPromptError";
  }
}

/**
 * A model scripted turn by turn.
 *
 * Each `Turn` may be taken once, in order, so a script can answer the same question differently
 * before and after a tool result -- which is what a multi-step exchange actually looks like.
 */
export function inMemoryLanguageModel(turns: readonly Turn[]): LanguageModelV4 {
  const remaining = [...turns];

  return {
    specificationVersion: "v4",
    provider: "undercroft-in-memory",
    modelId: "scripted",
    supportedUrls: {},

    doGenerate: () =>
      Promise.reject(
        new Error("inMemoryLanguageModel implements doStream only; nothing here calls doGenerate"),
      ),

    doStream: (options): Promise<{ stream: ReadableStream<LanguageModelV4StreamPart> }> => {
      const asked = lastUserText(options);
      const index = remaining.findIndex((candidate) =>
        asked.toLowerCase().includes(candidate.when.toLowerCase()),
      );
      if (index === -1) {
        return Promise.reject(
          new UnscriptedPromptError(
            asked,
            remaining.map((candidate) => candidate.when),
          ),
        );
      }
      const [taken] = remaining.splice(index, 1);
      const parts = partsFor(taken?.reply ?? []);

      return Promise.resolve({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            for (const part of parts) {
              controller.enqueue(part);
            }
            controller.close();
          },
        }),
      });
    },
  };
}
