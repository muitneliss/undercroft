/**
 * The assistant's one decision: given a transcript and a bound tool set, produce a stream.
 *
 * A capability interface rather than a config bag, in the shape `services/workerClient.ts`
 * established: the composition root builds one of these from a provider and a key, a test
 * builds one from a scripted model, and neither the handler nor this module reads an
 * environment variable (`layer-injected-deps`).
 *
 * The tool set arrives already bound to the caller. This module therefore holds no reference to
 * tRPC and makes no authorization decision -- it cannot, and that is the point: authority is
 * resolved by the real router in `handlers/assistantTools.ts`, so there is no second place for
 * it to be wrong.
 */

import type { LanguageModel, ToolSet, UIMessage } from "ai";
import { convertToModelMessages, stepCountIs, streamText } from "ai";
import type { PromptFacts } from "./prompt.ts";
import { systemPrompt } from "./prompt.ts";

/**
 * How many tool calls one question may cause.
 *
 * Eight is enough for the honest chains this catalogue makes possible -- list the customers,
 * read the schema, then answer -- and short enough that a model looping on a refusal stops
 * rather than spending a reader's budget on it. A bound is not a safety feature (the tiers are)
 * but an unbounded loop is a cost with no ceiling.
 */
export const MAX_STEPS = 8;

export interface RespondInput {
  readonly messages: UIMessage[];
  readonly tools: ToolSet;
  readonly facts: PromptFacts;
  /**
   * Which tools may not run until the reader strikes a proof of them.
   *
   * A function per tool rather than a flat status, because the SDK calls it with the REAL
   * ARGUMENTS at the moment the model proposes the call -- which is the only moment they
   * exist, and therefore the only moment the judge can be asked whether the reader's own words
   * asked for THIS action rather than for actions in general.
   */
  readonly approval: ApprovalPolicy;
}

/** `undefined` means no approval metadata: the tool runs, which is the read tier's answer. */
export type ApprovalDecision =
  | "user-approval"
  | { readonly type: "denied"; readonly reason: string }
  | undefined;

export type ApprovalPolicy = Record<string, (input: unknown) => Promise<ApprovalDecision>>;

/** What a stream of an answer looks like to the handler, without naming the SDK's result type. */
export type Responded = ReturnType<typeof streamText>;

export interface Assistant {
  readonly respond: (input: RespondInput) => Promise<Responded>;
  /** For the runbook and the unconfigured refusal: which model is answering. */
  readonly modelId: string;
}

/**
 * The assistant, over a language model.
 *
 * `respond` is async only because `convertToModelMessages` is: it may have to fetch a file part
 * a message referenced. The transcript handed in here has already been through
 * `validateUIMessages`, which is what makes it safe to convert a shape that arrived as jsonb.
 */
export function createAssistant(model: LanguageModel, approvalSecret?: string): Assistant {
  return {
    modelId: typeof model === "string" ? model : model.modelId,
    respond: async ({ messages, tools, facts, approval }) =>
      streamText({
        model,
        system: systemPrompt(facts),
        messages: await convertToModelMessages(messages),
        tools,
        toolApproval: approval,
        // HMAC-SIGNS each approval request against the tool name, call id and arguments, and
        // verifies the signature when the browser replays it. Without this, "the reader said
        // yes" is a claim the client makes about itself: a tampered body could approve a call
        // that was never offered, or approve a different one than was shown. Absent when no
        // secret is configured, which `main.ts` reports rather than hides.
        ...(approvalSecret === undefined
          ? {}
          : { experimental_toolApprovalSecret: approvalSecret }),
        stopWhen: stepCountIs(MAX_STEPS),
      }),
  };
}
