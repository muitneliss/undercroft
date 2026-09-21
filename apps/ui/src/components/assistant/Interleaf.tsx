/**
 * The interleaf: the assistant bound into the book as a sheet of the reader's own.
 *
 * It is a third grid area of `.book`, not a modal and not a portal -- the leaf beside it stays
 * in the document, in the tab order and on screen. `index.css` carries the reasoning for the
 * stock, the hairline and the absent shadow.
 *
 * LOADED LAZILY, and that is measured rather than tidy: importing `useChat` eagerly takes the
 * entry chunk from 528 kB to 710 kB, a third more bytes on first paint for a panel most page
 * loads never open. `Book.tsx` wraps it in `Suspense` the way `routeTable.tsx` already wraps
 * the six divisions.
 *
 * NO `useState`, which is banned here and gated by ast-grep. The draft lives in the Zustand
 * store with every other draft in this application (`.claude/rules/state.md`); `useChat` holds
 * the transcript, which is server state and therefore not the store's business either.
 *
 * ONLY THE LAST MESSAGE IS SENT. `prepareSendMessagesRequest` narrows the body to the sentence
 * just typed, because the server rebuilds the history from its own rows -- so a tampered body
 * cannot put words in the reader's mouth. See `handlers/chat.ts`.
 */

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { useTranslation } from "react-i18next";

import { useNavigate } from "react-router-dom";

import { Composer } from "@/components/assistant/Composer.tsx";
import { EmptyState } from "@/components/EmptyState.tsx";
import { Turn } from "@/components/assistant/Turn.tsx";
import { type ActionDeps, CLIENT_ACTIONS } from "@/lib/assistantActions.ts";
import { type AssistantTurn, figureNumbers } from "@/lib/assistantTurns.ts";
import { DIVISIONS, type DivisionId } from "@/lib/divisions.ts";
import { useUiStore } from "@/store.ts";

/** What a tool call looks like to the handler below, without naming the SDK's generic. */
interface ClientToolCall {
  readonly dynamic?: boolean;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly input?: unknown;
}

/**
 * The `navigate` tier, executed in the browser because it has no server-side `execute`.
 *
 * A module-level function rather than a closure in the hook options: it is the one piece of
 * this component that is worth reading on its own, and `lib/assistantActions.ts` holds the
 * decisions it dispatches to.
 *
 * `dynamic` is checked FIRST, as the SDK's own docs insist -- a dynamic call carries no typed
 * name, and treating one as a static name is how a handler acts on a tool it does not know.
 */
async function runClientTool(
  call: ClientToolCall,
  deps: ActionDeps,
  report: (output: {
    tool: string;
    toolCallId: string;
    output: unknown;
  }) => void | PromiseLike<void>,
): Promise<void> {
  if (call.dynamic === true) {
    return;
  }
  const act = CLIENT_ACTIONS[call.toolName];
  if (act === undefined) {
    return;
  }
  await report({
    tool: call.toolName,
    toolCallId: call.toolCallId,
    // The model is told what happened, because "I have opened the Journal for you" is only
    // true if it worked -- and `draftLakeQuery` has to be able to say it did NOT run.
    output: act(deps, call.input),
  });
}

/**
 * The turns, scrolling.
 *
 * Its own component because the panel was doing two jobs: wiring a chat, and drawing one. This
 * half is the drawing, and it owns the two facts that are properties of the TRANSCRIPT rather
 * than of any turn -- which figure number each turn opens at, and which turn (only ever the
 * last) is still being answered.
 */
function Transcript({
  turns,
  answering,
  onAnswer,
}: {
  turns: readonly AssistantTurn[];
  answering: boolean;
  onAnswer: (approvalId: string, approved: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const firsts = figureNumbers(turns);

  return (
    <div className="interleaf__turns">
      {turns.length === 0 ? (
        <EmptyState title={t("assistant.emptyTitle")} body={t("assistant.emptyBody")} />
      ) : null}

      {turns.map((turn, index) => (
        <Turn
          key={turn.id}
          turn={turn}
          // Only the LAST turn can be mid-answer. Passing `answering` to all of them would put
          // a caret on every paragraph the assistant has ever written.
          streaming={answering && index === turns.length - 1 && turn.role === "assistant"}
          firstFigureNumber={firsts[index] ?? 1}
          onAnswer={onAnswer}
        />
      ))}
    </div>
  );
}

export function Interleaf({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const toggleAssistant = useUiStore((state) => state.toggleAssistant);
  const navigate = useNavigate();
  const setLakeSql = useUiStore((state) => state.setLakeSql);

  /**
   * What the `navigate` tier is allowed to do to this browser.
   *
   * Assembled here, above the hook, so the hook option stays one line and the capabilities are
   * readable as a list: move, write a draft, and answer whether a division exists. Nothing else.
   */
  const browser: ActionDeps = {
    navigate: (path): void => {
      // `void`: react-router's navigate returns a promise and nothing here waits on it.
      void navigate(path);
    },
    setLakeSql,
    knownDivision: (id): id is DivisionId => DIVISIONS.some((entry) => entry.id === id),
  };

  const chat = useChat({
    /**
     * Once the reader has answered every proof, go on without them.
     *
     * Striking a proof is the reader saying "yes, do it"; asking them to then press send as
     * well would be asking twice for one decision.
     */
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onToolCall: ({ toolCall }): Promise<void> =>
      runClientTool(toolCall, browser, (output) => chat.addToolOutput(output)),
    transport: new DefaultChatTransport({
      api: "/api/assistant/chat",
      /**
       * The customer travels with every question rather than being bound once.
       *
       * The interleaf survives a change of customer -- it follows the reader the way a hand in
       * the margin does -- so which book is open is a property of the MESSAGE, not of the
       * panel. Binding it at mount would let a reader switch customers and go on asking
       * questions that were answered about the previous one.
       */
      prepareSendMessagesRequest: ({
        messages: sent,
      }): { body: { tenantId: string; message: UIMessage | undefined } } => ({
        body: { tenantId, message: sent.at(-1) },
      }),
    }),
  });

  // No cast: `AssistantTurn` is structural on purpose, so the SDK's own messages satisfy it and
  // `lib/assistantTurns.ts` stays testable against plain objects. See that module.
  const { messages, sendMessage, status, stop, addToolApprovalResponse } = chat;
  const turns: readonly AssistantTurn[] = messages;
  const answering = status === "submitted" || status === "streaming";

  return (
    <aside className="interleaf" aria-label={t("assistant.title")}>
      <span className="interleaf__punch interleaf__punch--a" aria-hidden="true" />
      <span className="interleaf__punch interleaf__punch--b" aria-hidden="true" />

      <div className="interleaf__head">
        <span className="label">{t("assistant.title")}</span>
        <button className="plate plate--small" type="button" onClick={toggleAssistant}>
          {t("assistant.close")}
        </button>
      </div>

      <Transcript
        turns={turns}
        answering={answering}
        onAnswer={(id, approved): void => {
          void addToolApprovalResponse({ id, approved });
        }}
      />

      <div className="interleaf__foot">
        <Composer
          answering={answering}
          onAsk={(text: string): void => {
            void sendMessage({ text });
          }}
          onStop={(): void => {
            void stop();
          }}
        />
      </div>
    </aside>
  );
}
