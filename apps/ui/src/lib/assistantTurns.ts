/**
 * Reading a `UIMessage` without knowing it is one.
 *
 * The AI SDK's part union is wide and grows, and the interleaf needs four questions answered
 * about it: what was said, which parts are figures, what state a figure is in, and whether a
 * result survived. Those are decisions, so they live here as pure functions over plain data
 * rather than as conditionals inside JSX -- which is what lets them be tested without a DOM,
 * the way every other `lib/` module here is.
 *
 * It deliberately does NOT import from `ai`. The types it needs are structural, the panel is
 * rendered from whatever the server sent, and a component that trusted the SDK's union would
 * have to be updated for every part kind the SDK adds -- including ones this product never
 * emits. Reading structurally means an unknown part is ignored rather than crashing the panel.
 */

/** The sentinel `transcript.ts` restores in place of an errored call's text. */
const ERROR_NOT_KEPT = "undercroft:error-not-kept";

export interface AssistantPart {
  readonly type: string;
  /** The arguments a proof was pulled on. Shown to the reader as mono rows. */
  readonly input?: unknown;
  /**
   * Present on an approval part.
   *
   * `isAutomatic` is the field that matters, and it is easy to miss: the SDK models an
   * AUTOMATIC decision -- one the injection gate made without asking anybody -- as an approval
   * request too. A panel that drew a proof for every request would ask the reader to confirm
   * things that were already refused on their behalf.
   */
  readonly approval?: {
    readonly id?: string;
    readonly approved?: boolean;
    readonly isAutomatic?: boolean;
    readonly reason?: string;
  };
  /** Present on a tool part. Used as the figure's React key -- see `figureKey`. */
  readonly toolCallId?: string;
  readonly text?: string;
  readonly state?: string;
  readonly toolName?: string;
  readonly output?: unknown;
  readonly errorText?: string;
}

export interface AssistantTurn {
  readonly id: string;
  readonly role: string;
  readonly parts: readonly AssistantPart[];
}

/** What a result came back as, once the not-kept cases are separated from the real ones. */
export type FigureOutcome =
  | { readonly kind: "pending" }
  /** Waiting for the reader to strike a proof. Carries the id their answer is keyed by. */
  | { readonly kind: "awaiting"; readonly approvalId: string }
  /** The reader discarded it, or the gate refused it. Struck, and it stays on the page. */
  | { readonly kind: "denied"; readonly reason?: string }
  | { readonly kind: "shown"; readonly output: unknown }
  /** Shown live, not kept. The panel says so rather than showing an empty frame. */
  | { readonly kind: "not-kept"; readonly summary?: string }
  | { readonly kind: "not-kept-failed" }
  | { readonly kind: "failed"; readonly why: string };

/**
 * A stable React key for one figure.
 *
 * The tool call id when there is one, which is the only identifier that survives a re-render
 * while the list is still growing. The index is the fallback and is deliberately last: keying a
 * streaming list by index is how React reuses the wrong element as parts arrive.
 */
export function figureKey(part: AssistantPart, index: number): string {
  return part.toolCallId ?? `${part.type}-${index}`;
}

/** Everything the reader or the assistant actually said, joined. */
export function textOf(turn: AssistantTurn): string {
  return turn.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

/** A tool part, whichever spelling the SDK used for it. */
export function isFigure(part: AssistantPart): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

export function figuresIn(turn: AssistantTurn): readonly AssistantPart[] {
  return turn.parts.filter(isFigure);
}

/** The tool's own name, for the caption. `dynamic-tool` carries it separately. */
export function toolNameOf(part: AssistantPart): string {
  return part.type === "dynamic-tool" ? (part.toolName ?? "") : part.type.slice("tool-".length);
}

/**
 * The approval half: is this still a question for the reader, or was it already settled?
 *
 * `isAutomatic` is checked FIRST and it is the subtle one. The SDK models a decision the
 * injection gate made -- without asking anybody -- as an approval request too, so a panel that
 * drew a proof for every request would ask the reader to confirm things already refused on
 * their behalf. See `services/assistant/judge.ts`.
 */
function approvalOutcome(part: AssistantPart): FigureOutcome | null {
  if (part.state === "approval-requested" && part.approval?.isAutomatic !== true) {
    const id = part.approval?.id;
    return id === undefined ? { kind: "pending" } : { kind: "awaiting", approvalId: id };
  }
  if (part.state === "output-denied" || part.state === "approval-responded") {
    const { reason } = part.approval ?? {};
    return reason === undefined ? { kind: "denied" } : { kind: "denied", reason };
  }
  return null;
}

/**
 * The digest half: did the payload survive, and if not, why not.
 *
 * A digest arrives AS the output rather than beside it (`transcript.ts` restores it there), so
 * "not kept" is read off the output's shape. That is the one place this module knows something
 * about the server, and it is a shape the server's own tests pin.
 */
function keptOutcome(output: unknown): FigureOutcome {
  if (output === null || typeof output !== "object" || !("kept" in output)) {
    return { kind: "shown", output };
  }
  if (output.kept !== false) {
    return { kind: "shown", output };
  }
  if ("failed" in output && output.failed === true) {
    return { kind: "not-kept-failed" };
  }
  const summary = "summary" in output ? output.summary : undefined;
  return typeof summary === "string" ? { kind: "not-kept", summary } : { kind: "not-kept" };
}

/** What this tool call came back as, if anything. */
export function outcomeOf(part: AssistantPart): FigureOutcome {
  const settled = approvalOutcome(part);
  if (settled !== null) {
    return settled;
  }
  if (part.state === "output-error") {
    return part.errorText === ERROR_NOT_KEPT
      ? { kind: "not-kept-failed" }
      : { kind: "failed", why: part.errorText ?? "" };
  }
  return part.state === "output-available" ? keptOutcome(part.output) : { kind: "pending" };
}

/**
 * Figure numbers, counted across the whole conversation.
 *
 * A manual numbers its figures once from the front, not per page, so the number a reader is
 * told ("see fig. 2") has to mean the same thing after three more questions. That makes it a
 * property of the transcript rather than of a turn, which is why it is computed here and passed
 * down rather than counted inside the component that draws one.
 */
export function figureNumbers(turns: readonly AssistantTurn[]): readonly number[] {
  const firsts: number[] = [];
  let seen = 0;
  for (const turn of turns) {
    firsts.push(seen + 1);
    seen += figuresIn(turn).length;
  }
  return firsts;
}
