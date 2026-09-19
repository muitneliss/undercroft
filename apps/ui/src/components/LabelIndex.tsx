/**
 * The index of Gmail's labels: a filter, then the runs, inside one bounded frame.
 *
 * A mailbox with sixty labels, set as one column of stacked checkboxes, is not a long screen
 * -- it is a broken one: the fieldset grew without limit, pushed SAVE past the fold, and left
 * two thirds of the leaf blank beside it. A reference manual does not set an index that way.
 * It sets it in columns, bounded by the height of the leaf it is printed on, with a running
 * head over each continued column, and it puts the entries somebody came to look up first.
 * `@/lib/labelIndex` decides the runs and their order; this file gives them their words.
 *
 * Its own module because it is the longest thing on the scope leaf and none of it is about
 * choosing a scope: it is about setting a list.
 */

import { useTranslation } from "react-i18next";

import type { Source } from "@/api/types.ts";
import { type BrowsedLabel, indexLabels, type LabelOwner } from "@/lib/labelIndex.ts";
import { useUiStore } from "@/store.ts";

/**
 * How many labels before the index needs to be searchable rather than merely readable.
 *
 * Below this the whole index fits in the frame without scrolling, and a filter over twelve
 * entries is a control that costs a glance and saves nothing.
 */
const FILTER_FROM = 12;

/** What each run of the index is called. Gmail says which run; the catalogue says the word. */
const RUN_HEAD = {
  user: "scopePicker.labelsMine",
  system: "scopePicker.labelsSystem",
  unclassified: "scopePicker.labelsUnclassified",
} as const;
/**
 * The index of labels: a filter, then the runs, inside one bounded frame.
 *
 * Both pieces of state it reads belong to the store rather than to this component -- the
 * ticks because Save has to find them, the filter because `useState` is banned and a second
 * owner of "what is on screen" is how a list and its filter drift apart. Each is read back
 * against the source it was recorded for, so neither can be left over from another one.
 *
 * The tally is said twice on purpose. `14 / 62` beside the field is legible in either
 * language and costs one glance; the sentence beside it is hidden from the page and live for
 * a screen reader, because a pair of bare numerals announced on their own names nothing.
 */
export function LabelIndex({
  source,
  items,
  chosen,
}: {
  source: Source;
  items: readonly BrowsedLabel[];
  chosen: readonly string[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((s) => s.locale);
  const typed = useUiStore((s) => s.scopeFilter);
  const setFilter = useUiStore((s) => s.setScopeFilter);
  const toggleLabel = useUiStore((s) => s.toggleScopeLabel);

  // Derived, not copied: a word typed against Gmail's labels narrows Gmail's labels and
  // nothing else, and this is what makes that true without an effect to clear it up after.
  const filter = typed.source === source ? typed.query : "";
  const runs = indexLabels(items, filter, locale);
  const shown = runs.reduce((count, run) => count + run.items.length, 0);
  const tally = { shown, total: items.length };

  return (
    <fieldset className="index">
      <legend className="label index__legend">{t("scopePicker.labelsHead")}</legend>

      {items.length >= FILTER_FROM ? (
        <div className="index__seek">
          <input
            type="search"
            className="input index__filter"
            value={filter}
            placeholder={t("scopePicker.filterPlaceholder")}
            aria-label={t("scopePicker.filterLabel")}
            onChange={(event): void => {
              setFilter(source, event.target.value);
            }}
          />
          <span aria-hidden="true" className="datum datum--quiet">
            {/* A ratio only once there is something to be a ratio of. Unfiltered, `62 / 62`
                says the same figure twice; `62 nhãn` says how big the mailbox is, which is
                the fact somebody arriving at this screen does not yet have. */}
            {filter === ""
              ? t("scopePicker.filterTotal", { count: items.length })
              : t("scopePicker.filterTally", tally)}
          </span>
          <span className="visually-hidden" aria-live="polite">
            {t("scopePicker.filterTallyRead", tally)}
          </span>
        </div>
      ) : null}

      <div className="index__field">
        {runs.map((run) => (
          <section key={runKey(run.kind)} className="index__run">
            <h2 className="label index__head">{t(RUN_HEAD[runKey(run.kind)])}</h2>
            <div className="index__cols">
              {run.items.map((label) => (
                <label key={label.id} className="punch">
                  <input
                    type="checkbox"
                    checked={chosen.includes(label.name)}
                    onChange={(): void => {
                      toggleLabel(source, label.name);
                    }}
                  />
                  <span className="punch__box" />
                  <span>{label.name}</span>
                </label>
              ))}
            </div>
          </section>
        ))}
        {shown === 0 ? <p className="note index__none">{t("scopePicker.noMatch")}</p> : null}
      </div>
    </fieldset>
  );
}

/** The null run needs a name to be keyed and headed by; it does not need a third meaning. */
function runKey(kind: LabelOwner): keyof typeof RUN_HEAD {
  return kind ?? "unclassified";
}
