/**
 * Drive's choice: Google's own Picker, running in the browser, and how deep to read.
 *
 * Its own file for the reason `XeroChoice` and `FileTypeChoice` are: each source's choice is
 * one self-contained control over the store's draft, and `ScopePicker` only decides which one
 * to show.
 *
 * Under the `drive.file` scope a server-side folder listing is not merely unnecessary, it is
 * impossible -- the credential cannot see anything that has not been picked. That is the
 * point: Google enforces the promise instead of our query filter.
 *
 * **How deep the read goes is a choice, and it is said while it is made.** "Sub-folders are
 * not read" used to be a standing note above the picker, because it was always true. Now that
 * it is true only until an admin ticks the box, it stands BENEATH the box as a line that
 * changes with the tick -- the pattern `GmailChoice` uses for "no label means the whole
 * mailbox", `role="status"` included, so a screen reader is told at the same moment.
 *
 * **The Picker is opened as the connection's own Google account.** `drive.file` grants a file
 * to the app for the Google account that picked it: a folder picked while the browser is
 * signed in as somebody else is granted to THAT account, and the connection being scoped would
 * be refused it at run time. So the connection's address goes to Google as the sign-in hint,
 * which matters the moment a tenant holds two Drive accounts (ADR 0043).
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
  const setDraft = useUiStore((s) => s.setScopeDraft);
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
            // Spread `chosen` rather than re-listing every other field: this used to hardcode
            // `fileTypes` (and every field but `files`) back to empty, so picking one more
            // file after choosing "Word documents" silently reset the run to "any file type".
            setDraft({ ...chosen, source, files: picked });
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
            <li key={file.id}>{file.name}</li>
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
