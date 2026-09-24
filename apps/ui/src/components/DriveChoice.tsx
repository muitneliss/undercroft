/**
 * Drive's choice: Google's own Picker, running in the browser, and how deep to read.
 *
 * Its own file for the reason `XeroChoice` and `FileTypeChoice` are: each source's choice is
 * one self-contained control over the store's draft, and `ScopePicker` only decides which one
 * to show.
 *
 * The Picker only chooses. What a run reads is the worker's own query over the picks, under the
 * connection's `drive.readonly` grant, which is also what lets the worker list folders for an
 * agent with no browser (ADR 0047). This screen keeps the Picker: it is Google's own view of
 * the account's Drive, and an admin already knows how to use it.
 *
 * **A Picker session adds; each pick is removed on its own.** Google's Picker always opens with
 * nothing ticked and cannot be told what was chosen before, so what a session hands back is
 * only ever MORE to read. It used to replace the list, and an admin who picked a second folder
 * in a second session lost the first (#197). Adding means the Picker can no longer say
 * "remove", so every listed pick carries its own control for that, named after the pick so a
 * screen reader hears which one it takes off.
 *
 * **How deep the read goes is a choice, and it is said while it is made.** "Sub-folders are
 * not read" used to be a standing note above the picker, because it was always true. Now that
 * it is true only until an admin ticks the box, it stands BENEATH the box as a line that
 * changes with the tick -- the pattern `GmailChoice` uses for "no label means the whole
 * mailbox", `role="status"` included, so a screen reader is told at the same moment.
 *
 * **The Picker is opened as the connection's own Google account.** A folder picked while the
 * browser is signed in as somebody else is a folder in THAT account's Drive, which the
 * connection being scoped may not be able to see at all, and its run would find nothing there.
 * So the connection's address goes to Google as the sign-in hint, which matters the moment a
 * tenant holds two Drive accounts (ADR 0043).
 */

import { useTranslation } from "react-i18next";

import { openDrivePicker } from "@/lib/drivePicker.ts";
import { type ScopeDraft, useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

export function DriveChoice({
  source,
  account,
  chosen,
}: {
  /** Which connection the draft is for -- an account, so two Drive accounts keep two drafts. */
  source: string;
  /** The Google account this connection belongs to, or `""` when none is recorded. */
  account: string;
  chosen: Omit<ScopeDraft, "source">;
}): React.JSX.Element {
  const { t } = useTranslation();
  const addFiles = useUiStore((s) => s.addScopeFiles);
  const removeFile = useUiStore((s) => s.removeScopeFile);
  const toggleRecurse = useUiStore((s) => s.toggleScopeRecurse);
  const config = trpc.config.google.useQuery();

  return (
    <>
      <button
        type="button"
        className="plate"
        disabled={config.data === undefined || config.data === null}
        onClick={(): void => {
          // Null when no ingestion client is configured; the button is disabled then,
          // and this guard is what makes that a type-level fact rather than a habit.
          const picker = config.data;
          if (picker === undefined || picker === null) {
            return;
          }
          void openDrivePicker(picker, { fileTypes: chosen.fileTypes, account }, (picked) => {
            addFiles(source, picked);
          });
        }}
      >
        {t("scopePicker.pickFromDrive")}
      </button>
      {config.isError ? (
        <p className="note">{t("scopePicker.pickerUnavailable")}</p>
      ) : (
        <ul className="stack stack--tight">
          {chosen.files.map((file) => (
            <li key={file.id} className="row">
              <span>{file.name}</span>
              <button
                type="button"
                className="plate plate--small"
                aria-label={t("scopePicker.removePickNamed", { name: file.name })}
                onClick={(): void => {
                  removeFile(source, file.id);
                }}
              >
                {t("scopePicker.removePick")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="punch">
        <input
          type="checkbox"
          checked={chosen.recurse}
          onChange={(): void => {
            toggleRecurse(source);
          }}
        />
        <span className="punch__box" />
        <span>{t("scopePicker.includeSubFolders")}</span>
      </label>
      <p className="note" role="status">
        {chosen.recurse ? t("scopePicker.willReadDeep") : t("scopePicker.willReadOneLevel")}
      </p>
    </>
  );
}
