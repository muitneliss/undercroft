/**
 * The conversation as a thing with rules, rather than three repo calls a handler makes in order.
 *
 * The handler used to open the thread, count its turns, read them, restore them and write them
 * back itself -- which `layer-handler-no-repo` refused, and correctly: transport was deciding
 * what a conversation IS. Those decisions live here, and the handler asks for a conversation.
 *
 * What is decided here:
 *
 * - A reader resuming gets the SAME thread for this customer, opened if they have not spoken
 *   here before, so history is never silently forked.
 * - A thread has a ceiling, and a reader at it is told to clear it rather than quietly answered
 *   worse. That is a cost ceiling, not a safety one -- the tiers are the safety.
 * - What survives a turn is `transcript.ts`'s decision, applied here at the one moment a turn
 *   comes to rest.
 *
 * Whether this reader may speak about this customer is NOT decided here. That is authority, and
 * it is resolved by the router's own middleware one layer up, so there is one definition of it.
 */

import type { SqlExecutor } from "@undercroft/db";
import type { UIMessage } from "ai";
import {
  clearThread,
  findThread,
  listTurns,
  openThread,
  saveTurn,
} from "../../repos/assistantThread.ts";
import { forStorage, restore, type Summarize, type UnvalidatedMessage } from "./transcript.ts";

/**
 * How many turns one reader may hold in one conversation.
 *
 * Enforced here rather than asked of the model, because a budget the model is asked to respect
 * is not a budget.
 */
export const MAX_TURNS = 200;

export interface Conversation {
  readonly threadId: string;
  /** The turns so far, digests and all, on their way to `validateUIMessages`. */
  readonly messages: readonly UnvalidatedMessage[];
  /** At the ceiling. The caller refuses with a sentence naming the way out. */
  readonly full: boolean;
}

/** Open or resume this reader's conversation about this customer. */
export async function resume(
  exec: SqlExecutor,
  tenantId: string,
  userId: string,
): Promise<Conversation> {
  const threadId = await openThread(exec, tenantId, userId);
  const turns = await listTurns(exec, threadId);
  return {
    threadId,
    messages: restore(turns),
    full: turns.length >= MAX_TURNS,
  };
}

/**
 * The conversation so far, WITHOUT opening one.
 *
 * A reader who opens the panel and asks nothing should not leave a row behind, so the read path
 * is separate from `resume` rather than a flag on it.
 */
export async function history(
  exec: SqlExecutor,
  tenantId: string,
  userId: string,
): Promise<readonly UnvalidatedMessage[]> {
  const threadId = await findThread(exec, tenantId, userId);
  return threadId === null ? [] : restore(await listTurns(exec, threadId));
}

/**
 * Commit a finished exchange.
 *
 * Every turn is written rather than only the new ones: `saveTurn` is idempotent by message id,
 * so re-writing an unchanged turn costs one statement and nothing else -- and diffing to find
 * "the new ones" would be a second, subtler definition of what the conversation contains.
 */
export async function remember(
  exec: SqlExecutor,
  threadId: string,
  messages: readonly UIMessage[],
  summarize: Summarize,
): Promise<void> {
  for (const turn of forStorage(messages, summarize)) {
    await saveTurn(exec, threadId, turn);
  }
}

/** Empty the conversation, keeping it. Reports how many turns went, never prunes silently. */
export async function clear(exec: SqlExecutor, tenantId: string, userId: string): Promise<number> {
  const threadId = await findThread(exec, tenantId, userId);
  return threadId === null ? 0 : await clearThread(exec, threadId);
}
