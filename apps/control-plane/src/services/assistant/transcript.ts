/**
 * What survives a turn, and what does not.
 *
 * The assistant reads the raw lake, so a tool result carries whatever a human wrote -- a
 * counterparty in a contract, an address in a mail subject, a filename. `.claude/rules/pii.md`
 * permits a document's text in `raw.document_text` and nowhere else (ADR 0024). This module is
 * the one place that decides what a transcript may keep, and `200_assistant.sql` enforces the
 * decision with a CHECK constraint so forgetting is a raised error rather than a silent leak.
 *
 * THE LINE IS BULK VERSUS CONVERSATION, not "anything a person typed".
 *
 * What actually protects a transcript is reachability: `app.assistant_turn` is granted to
 * `undercroft_app` alone, and no dbt or BI role has USAGE on `app` at all (040_grants.sql). It
 * is therefore less reachable than `raw.document_text`, which ADR 0024 grants to `undercroft_dbt`
 * outright. So the question is not "could this row hold a name" -- it is whether keeping the
 * thing earns its place at all:
 *
 * - The READER'S QUESTION and the ASSISTANT'S ANSWER are kept. They are the conversation. The
 *   reader asked for them and expects them back after a reload, and a sentence is not a corpus.
 * - A TOOL'S OUTPUT is digested away. It can be a whole document or several hundred rows, the
 *   reader already saw it live, and the next turn needs the gist rather than the payload. Keeping
 *   it would make `app` a second copy of the lake, which is the thing worth refusing.
 * - `errorText` is digested too. A Postgres refusal embeds the offending value -- the
 *   `(name)=(...)` detail -- so it is a payload wearing a refusal's clothes, and unlike an answer
 *   nobody chose to write it.
 * - REASONING is dropped. It is the model's scratch, the reader never saw it, and it quotes tool
 *   output freely.
 * - ANY PART KIND NOT ON THE LIST is dropped and NAMED. `source-document` alone carries `title`
 *   and `filename`, which is exactly the "a name a human wrote reaching Postgres" that `pii.md`
 *   forbids -- and it is a part kind this code never emits, which is the point: the allowlist
 *   is what makes a part kind the SDK adds later a decision instead of an accident.
 *
 * Nothing is invented to fill a gap. A tool that declares no safe summary is stored with none,
 * and renders as absent, because a plausible summary reads exactly like a true one. Rule 2.
 *
 * WHY NOTHING HERE IS CAST. `forStorage` reads the SDK's part union through its own predicate
 * (`isToolUIPart`), and `restore` hands back a deliberately UNVALIDATED shape for the handler to
 * put through `validateUIMessages` -- whose `messages` is `unknown` precisely so a caller does
 * not have to promise what it has not checked. Asserting `as UIMessage` over a row read out of
 * jsonb would be exactly that promise, about the one input most likely to be an older shape.
 */

import { getToolName, isToolUIPart, type UIMessage } from "ai";

/**
 * What is kept in place of a tool's result.
 *
 * `kept: false` is stated rather than implied, so a reader of a stored row -- or of the model's
 * own context on a later turn -- can tell "the result was nothing" from "the result is not here".
 */
export interface OutputDigest {
  readonly kept: false;
  /** A one-line summary the tool itself declared safe: a count, a status, an id. */
  readonly summary?: string;
  /** The call failed. The failure's shape is kept; its words are not. */
  readonly failed?: true;
}

/**
 * How a tool summarises its own output safely.
 *
 * The tool knows what is safe about its own result and the transcript does not, so the catalogue
 * supplies this rather than this module guessing. `null` means "nothing safe to say", which is a
 * legitimate and common answer.
 */
export type Summarize = (toolName: string, output: unknown) => string | null;

/**
 * Restored in place of an errored call's text.
 *
 * A sentinel rather than a sentence: `errorText` is typed `string` and the model reads it, but
 * the reader must see their own language, so the interleaf matches this value and renders an
 * i18n key instead of printing it. Not localised here -- a service writes no user-facing string
 * (`.claude/rules/i18n.md`).
 */
export const ERROR_NOT_KEPT = "undercroft:error-not-kept";

/** Named in place of a part kind the transcript refuses to store. */
export interface OmittedPart {
  readonly type: "data-omitted";
  readonly data: { readonly partType: string };
}

interface StoredTextPart {
  readonly type: "text";
  readonly text: string;
}

interface StoredStepPart {
  readonly type: "step-start";
}

/**
 * A tool call as it comes to rest: what was proposed, on what arguments, and how it ended.
 *
 * The digest goes under `digest` and NOT under `output`, deliberately: the table's CHECK forbids
 * an `output` key at any depth, which makes "no payload at rest" an invariant of the stored
 * bytes rather than a property of this function. `restore` is the single place the key comes back.
 */
interface StoredToolPart {
  readonly type: string;
  readonly state: string;
  readonly toolCallId: string;
  readonly toolName?: string;
  readonly title?: string;
  readonly input?: unknown;
  /**
   * The approval as the SDK wrote it, `signature` included. That signature is an HMAC over the
   * tool name, call id and arguments -- not customer data -- and dropping it would leave a
   * restored proof unapprovable.
   */
  readonly approval?: unknown;
  readonly digest?: OutputDigest;
}

export type StoredPart = StoredTextPart | StoredStepPart | StoredToolPart | OmittedPart;

export interface StoredTurn {
  readonly messageId: string;
  readonly ordinal: number;
  readonly role: "user" | "assistant";
  readonly parts: readonly StoredPart[];
}

function storedToolPart(
  part: Extract<UIMessage["parts"][number], { toolCallId: string }>,
  summarize: Summarize,
): StoredToolPart {
  const digest = ((): OutputDigest | undefined => {
    if (part.state === "output-available") {
      const summary = summarize(getToolName(part), part.output);
      return summary === null ? { kept: false } : { kept: false, summary };
    }
    return part.state === "output-error" ? { kept: false, failed: true } : undefined;
  })();

  return {
    type: part.type,
    state: part.state,
    toolCallId: part.toolCallId,
    ...(part.type === "dynamic-tool" ? { toolName: part.toolName } : {}),
    ...(part.title === undefined ? {} : { title: part.title }),
    ...(part.input === undefined ? {} : { input: part.input }),
    ...(part.approval === undefined ? {} : { approval: part.approval }),
    ...(digest === undefined ? {} : { digest }),
  };
}

function storedPart(part: UIMessage["parts"][number], summarize: Summarize): StoredPart {
  if (part.type === "text") {
    return { type: "text", text: part.text };
  }
  if (part.type === "step-start") {
    return { type: "step-start" };
  }
  if (isToolUIPart(part)) {
    return storedToolPart(part, summarize);
  }
  return { type: "data-omitted", data: { partType: part.type } };
}

/**
 * The transcript as it goes to rest.
 *
 * System messages are dropped: the prompt is the server's and is rebuilt every turn from
 * `prompt.ts`, so storing a copy would create a second, ageing definition of it.
 */
export function forStorage(
  messages: readonly UIMessage[],
  summarize: Summarize,
): readonly StoredTurn[] {
  const turns: StoredTurn[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role === "system") {
      continue;
    }
    turns.push({
      messageId: message.id,
      ordinal: index,
      role: message.role,
      parts: message.parts.map((part) => storedPart(part, summarize)),
    });
  }
  return turns;
}

/** A turn as the repo hands it back: `parts` is whatever jsonb held, which is to say unknown. */
export interface TurnAtRest {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly parts: unknown;
}

/**
 * A message on its way to `validateUIMessages`, not yet known to be one.
 *
 * The parts are `unknown` on purpose: a row written by an older shape of this code is a real
 * possibility, and the SDK's validator is a better answer to it than a cast would be.
 */
export interface UnvalidatedMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly parts: readonly unknown[];
}

function restoredPart(raw: unknown): unknown {
  // `in` rather than a cast: it narrows, so the property access below is checked rather than
  // promised. A part with no digest was never reduced and comes back exactly as it went in.
  if (raw === null || typeof raw !== "object" || !("digest" in raw)) {
    return raw;
  }
  const { digest, ...rest } = raw;
  // A digested call is restored to the state it actually reached, carrying the digest where the
  // payload was. The model is told plainly that the result is not kept -- so if it needs those
  // rows again it calls the tool again, which is correct: a stale payload re-presented as
  // current is the one outcome worse than a missing one.
  return "state" in rest && rest.state === "output-error"
    ? { ...rest, errorText: ERROR_NOT_KEPT }
    : { ...rest, output: digest };
}

/** The transcript as the model and the interleaf read it back. */
export function restore(turns: readonly TurnAtRest[]): UnvalidatedMessage[] {
  return turns.map((turn) => ({
    id: turn.messageId,
    role: turn.role,
    parts: (Array.isArray(turn.parts) ? turn.parts : []).map(restoredPart),
  }));
}
