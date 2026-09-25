/**
 * The line beneath a scope tick-list: what the ticks will read, and the two one-step ways to
 * change all of them at once.
 *
 * THREE STATES, NOT TWO, AND THE TWO ENDS ARE OPPOSITES. Every list it serves -- Gmail's
 * labels, the file types, Xero's kinds of data -- reads "nothing ticked" as OPEN: everything,
 * including a label, a type or a kind that appears later. A list with every entry ticked is
 * CLOSED: only those entries, and nothing that appears later. The two can read the same data
 * on the day they are saved and part the day something new turns up, so they are never allowed
 * to share a sentence; a reader must be able to tell them apart without counting ticks. The
 * caller supplies the words for each state, because only it knows what its list reads, and this
 * module decides which state holds -- once, rather than in each of four pickers.
 *
 * HubSpot's properties are the one list whose empty end is NARROW: nothing ticked reads the
 * spec's own properties alone, and a tick only ever adds (ADR 0052). The full end is closed as
 * everywhere else. Nothing here changes for that -- the three states are the same three -- which
 * is exactly why the words belong to the caller.
 *
 * Select all hides when there is nothing left for it to add -- every offered entry ticked, or a
 * list that offers none, such as a mailbox with no labels -- the same way Clear all hides when
 * there is nothing to clear. What counts as "every" is measured against what the screen
 * OFFERS, so an entry held but not offered -- a custom file type, a label the mailbox no longer
 * lists -- neither blocks the full state nor is dropped by it (the store's `withEvery`).
 *
 * The sentence carries `role="status"` for the reason `GmailChoice` first gave: a screen reader
 * is told the consequence at the moment of the tick, rather than left to infer it.
 */

import { useTranslation } from "react-i18next";

/** How much of what the screen offers is ticked. Wordless; the caller's `says` has the words. */
type Coverage = "none" | "some" | "every";

function coverageOf(chosen: readonly string[], offered: readonly string[]): Coverage {
  if (chosen.length === 0) {
    return "none";
  }
  return offered.every((entry) => chosen.includes(entry)) ? "every" : "some";
}

export function ChoiceEcho({
  chosen,
  offered,
  says,
  onSelectAll,
  onClear,
}: {
  chosen: readonly string[];
  /** Every entry the list on screen offers to tick; what Select all adds. */
  offered: readonly string[];
  /**
   * What will be read, in each state. `none` is nothing ticked -- the open reading for every
   * list but HubSpot's, where it is the spec's floor -- and `every` the closed one.
   */
  says: Readonly<Record<Coverage, string>>;
  onSelectAll: () => void;
  onClear: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const coverage = coverageOf(chosen, offered);

  return (
    <div className="echo">
      <span className="label">{t("scopePicker.echoHead")}</span>
      <p className="note echo__says" role="status">
        {says[coverage]}
      </p>
      <div className="row">
        {coverage === "every" || offered.length === 0 ? null : (
          <button type="button" className="plate plate--small" onClick={onSelectAll}>
            {t("scopePicker.selectAll")}
          </button>
        )}
        {coverage === "none" ? null : (
          <button type="button" className="plate plate--small" onClick={onClear}>
            {t("scopePicker.clearAll")}
          </button>
        )}
      </div>
    </div>
  );
}
