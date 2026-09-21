/**
 * THE PLATE CASE: what the assistant may set, and the fact that it cannot cut a new plate.
 *
 * This is the answer to "let the assistant render UI from the data itself", and the shape of
 * the answer is the whole security and design argument, so it is worth stating plainly.
 *
 * The model does NOT emit markup. It calls a tool; the tool's declared `plate` names one of the
 * printed components this application already has; and the output is handed to that component
 * as props. A closed registry, keyed by plate.
 *
 * WHY NOT AN HTML TOOL, which is the obvious way to do this and what most chat products ship:
 *
 * - It is an XSS surface on an authenticated page that can reach `lake.query`. Sanitising is a
 *   mitigation for a hazard we can simply not have.
 * - It would let the model invent visuals outside `DESIGN.md` -- an easing curve, a modal, a
 *   coloured badge, vermilion on something that is not an erratum -- and every one of those
 *   renders perfectly while being wrong. A model cannot read the Wheel Rule.
 *
 * So the registry is a feature and not a limitation: the assistant composes from the same
 * vocabulary the rest of the book is set in, and a plate it has no case for is reported rather
 * than approximated. ADR 0029.
 *
 * The caption is an honesty device as much as a decoration. A numbered figure is visibly
 * QUOTED into the conversation, so a reader can always tell what the assistant set apart from
 * what the application drew -- which matters most in the case this panel exists for, where the
 * two sit a few centimetres apart.
 */

import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/EmptyState.tsx";
import { Errata } from "@/components/Errata.tsx";
import { type AssistantPart, outcomeOf, toolNameOf } from "@/lib/assistantTurns.ts";

/**
 * A result whose plate this build has no case for.
 *
 * Named rather than approximated, and NOT rendered as an empty frame: the reader saw the
 * assistant look something up, so the panel owes them either the thing or a sentence. Rule 2.
 */
function Unset({ tool }: { tool: string }): React.JSX.Element {
  const { t } = useTranslation();
  return <p className="figure__absent">{t("assistant.ranTool", { tool })}</p>;
}

export function Figure({
  part,
  number,
}: {
  part: AssistantPart;
  number: number;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const outcome = outcomeOf(part);
  const tool = toolNameOf(part);

  // Nothing is drawn for a call still in flight. The turn's own caret already says more is
  // coming, and a second "loading" beside it would be two answers to one question.
  if (outcome.kind === "pending") {
    return null;
  }

  // A genuine failure tips in the correction slip -- the one object in the system that wears
  // vermilion, and this is exactly what it is for.
  if (outcome.kind === "failed") {
    return (
      <Errata heading={t("assistant.failedTitle")} live={true}>
        {t("assistant.failedBody")}
      </Errata>
    );
  }

  return (
    <div className="figure">
      <span className="figure__caption">{t("assistant.figure", { number })}</span>
      {outcome.kind === "not-kept" ? (
        <p className="figure__absent">
          {outcome.summary === undefined
            ? t("assistant.notKept")
            : `${t("assistant.ranTool", { tool })} — ${outcome.summary}`}
        </p>
      ) : null}
      {outcome.kind === "not-kept-failed" ? (
        <p className="figure__absent">{t("assistant.notKeptFailed")}</p>
      ) : null}
      {outcome.kind === "shown" ? <Plate tool={tool} output={outcome.output} /> : null}
    </div>
  );
}

/**
 * One plate from the case.
 *
 * Only `facts` is implemented in this release, deliberately. The remaining plates -- the table,
 * the chart, the run row, the grant row, the question tile -- are the next change, and each is
 * an existing component wired to a tool's real output shape rather than to a guess about it.
 * Until then an unset plate SAYS it is unset, which is the honest half of shipping half.
 */
function Plate({ tool, output }: { tool: string; output: unknown }): React.JSX.Element {
  const { t } = useTranslation();

  if (Array.isArray(output) && output.length === 0) {
    return <EmptyState title={t("assistant.emptyTitle")} body={t("common.nothingToShow")} />;
  }
  return <Unset tool={tool} />;
}
