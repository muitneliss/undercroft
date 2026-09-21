/**
 * A PROOF: the printer's trial impression, pulled before the press run.
 *
 * This is the focal moment of the whole feature, so it is worth saying what each decision is
 * for. A proof shows the reader one sentence describing what will happen, the arguments it
 * will happen with, and two plates. Nothing runs until they strike it.
 *
 * THE SENTENCE COMES FROM THE CATALOGUE, not from the model. Asking the thing that proposed an
 * action to also word the confirmation of it is how a reader ends up striking a sentence that
 * does not describe what will run. The tool declares a `proofKey`; the i18n catalogue holds the
 * sentence; the arguments are interpolated into it.
 *
 * IT IS NOT VERMILION. `DESIGN.md`'s Vermilion Rule holds even here -- especially here: a
 * destructive plate is an ordinary plate, because the safety is the confirmation step and not
 * the colour. Vermilion belongs to the errata slip alone, and a proof is not a correction.
 *
 * ITS BINDING EDGE IS PERFORATED, which is the same dashed hairline a *pending* grant wears,
 * because it is exactly that state: something awaiting a decision. Reusing that mark rather
 * than inventing one means a reader who has seen a half-hinged source already knows what this
 * is.
 *
 * A DISCARDED PROOF STAYS ON THE PAGE, struck. `PRODUCT.md`'s third principle: refusal is a
 * first-class outcome. A proof that vanished when declined would leave the reader unsure
 * whether they declined it or it ran.
 */

import { useTranslation } from "react-i18next";

import { PRIVILEGED_TOOLS, proofSentence, proofValues } from "@/lib/assistantProofs.ts";
import { type AssistantPart, toolNameOf } from "@/lib/assistantTurns.ts";
import { useUiStore } from "@/store.ts";

/** The arguments, as mono rows. A datum is a datum, whatever it is confirming. */
function Arguments({ input }: { input: unknown }): React.JSX.Element | null {
  if (input === null || typeof input !== "object") {
    return null;
  }
  return (
    <dl className="proof__args">
      {Object.entries(input).map(([name, value]) => (
        <div className="proof__arg" key={name}>
          <dt className="label">{name}</dt>
          <dd className="datum">{typeof value === "string" ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Proof({
  part,
  approvalId,
  onAnswer,
}: {
  part: AssistantPart;
  approvalId: string;
  onAnswer: (approvalId: string, approved: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tool = toolNameOf(part);
  const typed = useUiStore((state) => state.assistantConfirm);
  const setTyped = useUiStore((state) => state.setAssistantConfirm);

  /**
   * The privileged tier's second gate: type the object's name.
   *
   * Only for the tools whose blast radius is a customer's data. A one-click strike is right for
   * "run the ingest now" -- worst case it runs twice -- and wrong for "revoke this grant",
   * where the reader has to demonstrate they read WHICH object rather than that they read a
   * button. The name to type is the argument the action turns on.
   */
  const guard = PRIVILEGED_TOOLS[tool];
  const expected = guard === undefined ? null : (proofValues(part.input)[guard] ?? "");
  const unlocked = expected === null || typed.trim() === expected;

  // A mutation with no sentence is a misdeclared tool, and `catalogue.test.ts` fails on one.
  // If one ever reaches a reader, they are told which action would run rather than shown a
  // blank slip they might strike anyway.
  const sentence = proofSentence(t, tool, part.input) ?? t("assistant.ranTool", { tool });

  return (
    <div className="proof">
      <span className="label proof__head">{t("assistant.proof.head")}</span>
      <p className="proof__says">{sentence}</p>
      <Arguments input={part.input} />

      {expected === null ? null : (
        // `row row--field`, never a bare `.row`: the row holds a `.field`. Gated by
        // `row-field-alignment` (ADR 0027).
        <div className="row row--field">
          <label className="field">
            <span className="label">{t("assistant.proof.confirmLabel")}</span>
            <input
              className="input"
              type="text"
              value={typed}
              placeholder={expected}
              onChange={(event): void => setTyped(event.target.value)}
            />
            <span className="field__hint">{t("assistant.proof.confirmHint", { expected })}</span>
          </label>
        </div>
      )}

      <div className="row">
        <button
          className="plate plate--primary"
          type="button"
          disabled={!unlocked}
          onClick={(): void => {
            onAnswer(approvalId, true);
            setTyped("");
          }}
        >
          {t("assistant.proof.strike")}
        </button>
        <button
          className="plate"
          type="button"
          onClick={(): void => {
            onAnswer(approvalId, false);
            setTyped("");
          }}
        >
          {t("assistant.proof.discard")}
        </button>
      </div>
    </div>
  );
}

/** A proof the reader discarded, or the gate refused. Struck, and still on the page. */
export function StruckProof({ part }: { part: AssistantPart }): React.JSX.Element {
  const { t } = useTranslation();
  const tool = toolNameOf(part);

  return (
    <div className="proof proof--struck">
      <span className="label proof__head">{t("assistant.proof.struck")}</span>
      <p className="proof__says">
        {proofSentence(t, tool, part.input) ?? t("assistant.ranTool", { tool })}
      </p>
    </div>
  );
}
