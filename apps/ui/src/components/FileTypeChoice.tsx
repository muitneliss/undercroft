/**
 * Gmail and Drive's choice: which file types to land.
 *
 * Empty is a recorded decision, not an absent one: it means every file type, said above the
 * list as a hint and beneath it as the echo that changes with each tick -- the same pattern
 * `LabelIndex` uses for "no label means the whole mailbox", and "Clear all" is the same
 * one-click path to it.
 *
 * A type typed into the free-text field joins the SAME checklist the curated types sit in,
 * rather than a separate list of removable chips: once added it is indistinguishable from a
 * curated tick, and unchecking either one is the one way to remove anything from the
 * allow-list.
 *
 * Its own module for the reason `XeroChoice` and `LabelIndex` are: it is a control, shared by
 * two sources, not a page.
 */

import { useTranslation } from "react-i18next";

import {
  CURATED_FILE_TYPES,
  describeFileType,
  isCuratedFileType,
  isPlausibleMimeType,
  normalizeFileType,
} from "@/lib/fileTypes.ts";
import { useUiStore } from "@/store.ts";

export function FileTypeChoice({
  source,
  fileTypes,
}: {
  /** Which connection the draft is for -- an account, so two mailboxes keep two drafts apart. */
  source: string;
  fileTypes: readonly string[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const toggleFileType = useUiStore((s) => s.toggleScopeFileType);

  // Curated types keep a fixed order; a custom addition is appended after them, in the order
  // it was added.
  const offered = [...CURATED_FILE_TYPES, ...fileTypes.filter((type) => !isCuratedFileType(type))];

  return (
    <>
      <p className="note">{t("scopePicker.anyFileTypeHint")}</p>

      <fieldset className="index">
        <legend className="label index__legend">{t("scopePicker.fileTypesHead")}</legend>
        <div className="index__field">
          <div className="index__cols">
            {offered.map((type) => (
              <label key={type} className="punch">
                <input
                  type="checkbox"
                  checked={fileTypes.includes(type)}
                  onChange={(): void => {
                    toggleFileType(source, type);
                  }}
                />
                <span className="punch__box" />
                <span>{describeFileType(t, type)}</span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <CustomFileType source={source} fileTypes={fileTypes} />
      <FileTypeEcho source={source} fileTypes={fileTypes} />
    </>
  );
}

/** The free-text field that adds one more type to the checklist above. */
function CustomFileType({
  source,
  fileTypes,
}: {
  source: string;
  fileTypes: readonly string[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const toggleFileType = useUiStore((s) => s.toggleScopeFileType);
  const typed = useUiStore((s) => s.fileTypeInput);
  const setTyped = useUiStore((s) => s.setFileTypeInput);

  // Derived, not copied: the same reasoning `LabelIndex`'s filter gives for reading its typed
  // value back against `source`, so a half-typed type against Gmail cannot survive a move to
  // Drive's picker.
  const input = typed.source === source ? typed.value : "";
  const normalized = normalizeFileType(input);

  function addCustom(): void {
    if (!isPlausibleMimeType(normalized)) {
      return;
    }
    if (!fileTypes.includes(normalized)) {
      toggleFileType(source, normalized);
    }
    setTyped(source, "");
  }

  return (
    <>
      <div className="index__seek">
        <input
          type="text"
          className="input"
          value={input}
          placeholder={t("scopePicker.fileTypesCustomPlaceholder")}
          aria-label={t("scopePicker.fileTypesCustomLabel")}
          onChange={(event): void => {
            setTyped(source, event.target.value);
          }}
        />
        <button type="button" className="plate plate--small" onClick={addCustom}>
          {t("scopePicker.fileTypesCustomAdd")}
        </button>
      </div>
      {input !== "" && !isPlausibleMimeType(normalized) ? (
        <p className="note">{t("scopePicker.fileTypesCustomInvalid")}</p>
      ) : null}
    </>
  );
}

/** What will be read, said again beneath the list as it is chosen -- same pattern as Gmail's labels. */
function FileTypeEcho({
  source,
  fileTypes,
}: {
  source: string;
  fileTypes: readonly string[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const clearFileTypes = useUiStore((s) => s.clearScopeFileTypes);

  return (
    <div className="echo">
      <span className="label">{t("scopePicker.echoHead")}</span>
      <p className="note echo__says" role="status">
        {fileTypes.length === 0
          ? t("scope.anyFileType")
          : t("scope.fileTypesChosen", { count: fileTypes.length })}
      </p>
      {fileTypes.length > 0 ? (
        <button
          type="button"
          className="plate plate--small"
          onClick={(): void => {
            clearFileTypes(source);
          }}
        >
          {t("scopePicker.clearAll")}
        </button>
      ) : null}
    </div>
  );
}
