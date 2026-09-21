/**
 * One half of the conversation: what the reader asked, or what the assistant answered.
 *
 * ONE VOICE, TWO INKS. Both are Garamond, because both are sentences a person reads to decide
 * something -- which is what `DESIGN.md`'s Two Voices Rule reserves Garamond for. The reader's
 * own turns are Ink 2 behind a printer's fist; the assistant's are Ink. A third type voice was
 * the obvious move and would have been wrong: caps make a long question unreadable, mono makes
 * a sentence look like a datum, and ink is the one distinction that survives any length.
 *
 * Text parts are joined rather than rendered one element each. A provider streams a sentence in
 * pieces, and one `<p>` per delta would set a paragraph per syllable.
 */

import { useTranslation } from "react-i18next";

import { Figure } from "@/components/assistant/Figure.tsx";
import { Proof, StruckProof } from "@/components/assistant/Proof.tsx";
import type { AssistantPart, AssistantTurn } from "@/lib/assistantTurns.ts";
import { figureKey, figuresIn, outcomeOf, textOf } from "@/lib/assistantTurns.ts";

/** The manual's index mark. A glyph, so it carries no accessible name of its own. */
const FIST = "☞";

function Asked({ said }: { said: string }): React.JSX.Element {
  return (
    <div className="turn turn--asked">
      <span className="turn__fist" aria-hidden="true">
        {FIST}
      </span>
      <p className="turn__said">{said}</p>
    </div>
  );
}

/**
 * One tool part: a proof awaiting the reader, a struck one, or a figure.
 *
 * The three are the same object at different moments, which is why they are chosen here rather
 * than in three places -- the state comes from `outcomeOf`, so the panel cannot disagree with
 * itself about whether something is still a question.
 */
function ToolPart({
  part,
  number,
  onAnswer,
}: {
  part: AssistantPart;
  number: number;
  onAnswer: (approvalId: string, approved: boolean) => void;
}): React.JSX.Element | null {
  const outcome = outcomeOf(part);
  if (outcome.kind === "awaiting") {
    return <Proof part={part} approvalId={outcome.approvalId} onAnswer={onAnswer} />;
  }
  if (outcome.kind === "denied") {
    return <StruckProof part={part} />;
  }
  return <Figure part={part} number={number} />;
}

function Answered({
  said,
  streaming,
  figures,
  firstFigureNumber,
  onAnswer,
}: {
  said: string;
  streaming: boolean;
  figures: readonly AssistantPart[];
  firstFigureNumber: number;
  onAnswer: (approvalId: string, approved: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="turn">
      {/* The text comes FIRST even though the tools ran before it. The reader wants the answer,
          and the figures are the evidence under it -- which is the order `PRODUCT.md`'s
          "evidence before assurance" asks for, read the way a page is read. */}
      {said === "" ? null : (
        <p className={streaming ? "turn__said turn__said--streaming" : "turn__said"}>{said}</p>
      )}

      {figures.map((part, index) => (
        <ToolPart
          key={figureKey(part, index)}
          part={part}
          number={firstFigureNumber + index}
          onAnswer={onAnswer}
        />
      ))}

      {/* Announced, not drawn: the caret in the stylesheet says more is coming to a reader who
          can see it, and this says it to one who cannot. */}
      {streaming ? (
        <span className="visually-hidden" role="status">
          {t("assistant.working")}
        </span>
      ) : null}
    </div>
  );
}

export function Turn({
  turn,
  streaming,
  firstFigureNumber,
  onAnswer,
}: {
  turn: AssistantTurn;
  /** This is the last turn and the answer is still arriving. */
  streaming: boolean;
  /** Figures are numbered across the whole conversation, as a manual numbers them. */
  firstFigureNumber: number;
  /** The reader's answer to a proof, keyed by the approval it belongs to. */
  onAnswer: (approvalId: string, approved: boolean) => void;
}): React.JSX.Element {
  const said = textOf(turn);

  if (turn.role === "user") {
    return <Asked said={said} />;
  }
  return (
    <Answered
      said={said}
      streaming={streaming}
      figures={figuresIn(turn)}
      firstFigureNumber={firstFigureNumber}
      onAnswer={onAnswer}
    />
  );
}
