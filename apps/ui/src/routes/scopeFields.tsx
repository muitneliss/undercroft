/**
 * The pieces of the scope picker: the two source-specific choosers, the lead, the save
 * control, and the hooks behind them.
 *
 * Split from `ScopePicker.tsx` so the page reads as a page. Each piece here answers one
 * question about a SELECTION -- which labels, which files, what gets stored, what the server
 * said when it refused -- and none of them knows about routing.
 */

import { useTranslation } from "react-i18next";
import type { Source } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { type GooglePickerConfig, openDrivePicker } from "@/lib/drivePicker.ts";
import { type BrowsedLabel, indexLabels, type LabelOwner } from "@/lib/labelIndex.ts";
import { type ScopeDraft, useUiStore } from "@/store.ts";
import type { trpc } from "@/trpc.ts";

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
function LabelIndex({
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

/** Choosing Gmail labels, or saying why the list could not be read. */
export function GmailScope({
  source,
  items,
  loadError,
  chosenLabels,
  clearLabels,
}: {
  source: Source;
  items: readonly BrowsedLabel[];
  loadError: string | null;
  chosenLabels: readonly string[];
  clearLabels: (source: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return loadError === null ? (
    items.length === 0 ? (
      <p className="note">{t("scopePicker.nothingToChoose")}</p>
    ) : (
      <>
        <LabelIndex source={source} items={items} chosen={chosenLabels} />

        <div className="echo">
          <span className="label">{t("scopePicker.echoHead")}</span>
          <p className="note echo__says" role="status">
            {chosenLabels.length === 0
              ? t("scope.gmailWholeMailbox")
              : t("scopePicker.echoChosen", { count: chosenLabels.length })}
          </p>
          {chosenLabels.length > 0 ? (
            <button
              type="button"
              className="plate plate--small"
              onClick={(): void => {
                clearLabels(source);
              }}
            >
              {t("scopePicker.clearAll")}
            </button>
          ) : null}
        </div>
      </>
    )
  ) : (
    <Errata heading={t("common.notLoaded")} live={true}>
      {loadError}
    </Errata>
  );
}

/**
 * Choosing Drive files, which happens in Google's own picker rather than on this page.
 *
 * The button is disabled when no ingestion client is configured, and the guard inside the
 * handler is what makes that a type-level fact rather than a habit.
 */
export function DriveScope({
  source,
  picker,
  pickerUnavailable,
  chosenFiles,
  setDraft,
}: {
  source: Source;
  picker: GooglePickerConfig | null | undefined;
  pickerUnavailable: boolean;
  chosenFiles: ScopeDraft["files"];
  setDraft: (draft: ScopeDraft) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <button
        type="button"
        className="plate"
        disabled={picker === undefined || picker === null}
        onClick={(): void => {
          // Null when no ingestion client is configured; the button is disabled then,
          // and this guard is what makes that a type-level fact rather than a habit.
          if (picker === undefined || picker === null) {
            return;
          }
          void openDrivePicker(picker, (picked) => {
            setDraft({ source, labels: [], files: picked });
          });
        }}
      >
        {t("scopePicker.pickFromDrive")}
      </button>
      {pickerUnavailable ? (
        <p className="note">{t("scopePicker.pickerUnavailable")}</p>
      ) : (
        <ul className="stack stack--tight">
          {chosenFiles.map((file) => (
            <li key={file.id}>{file.name}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** What this page is asking for, in the words the source calls for. */
export function ScopeLead({ source }: { source: Source }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="body stack">
      <h1>{t("scopePicker.title")}</h1>
      <p className="prose prose--lead">
        {source === "gmail" ? t("scopePicker.leadGmail") : t("scopePicker.leadDrive")}
      </p>

      {source === "gmail" ? (
        <p className="note">{t("scopePicker.wholeMailboxHint")}</p>
      ) : (
        <p className="note">{t("scopePicker.directChildrenOnly")}</p>
      )}
    </div>
  );
}

/** The save button, and the server's words when a selection could not be stored. */
export function SaveScope({
  setScope,
  onSave,
}: {
  setScope: ReturnType<typeof trpc.connections.setScope.useMutation>;
  onSave: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {setScope.isError ? (
        <Errata heading={t("scopePicker.notSaved")} live={true}>
          {setScope.error.message}
        </Errata>
      ) : null}

      <button
        type="button"
        className="plate plate--primary"
        disabled={setScope.isPending}
        onClick={onSave}
      >
        {setScope.isPending ? t("scopePicker.saving") : t("scopePicker.save")}
      </button>
    </>
  );
}
