/**
 * Choosing what a connected source may read.
 *
 * This screen is the difference between a consent card that tells the truth and one that
 * does not. The card promises "PDFs inside the folders you select. No other folder is read"
 * and "headers and PDF attachments in {{labels}}"; without somewhere to make that selection,
 * connecting Gmail would read an entire mailbox while the screen claimed otherwise.
 *
 * THE TWO SOURCES CHOOSE DIFFERENTLY, AND FOR A REASON WORTH KNOWING.
 *
 * **Gmail** is a list of labels, fetched through the worker because it needs a live token.
 * Choosing none is a *recorded decision* meaning the whole mailbox -- not an empty one --
 * which is why the server refuses a connection with no row at all rather than defaulting it.
 *
 * **Drive** is Google's own Picker, running in the browser. Under the `drive.file` scope a
 * server-side folder listing is not merely unnecessary, it is impossible: the credential
 * cannot see anything that has not been picked. That is the point -- Google enforces the
 * promise instead of our query filter, and the scope needs no annual CASA assessment.
 *
 * `useState` is banned, so the in-progress selection lives in the Zustand store: a draft the
 * user has made and no endpoint knows about is exactly what the store is for.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { Source } from "@/api/types";
import { SOURCE_LABEL } from "@/api/types";
import { Errata } from "@/components/Errata";
import { Skeleton } from "@/components/Skeleton";
import { divisionPath } from "@/lib/divisions";
import { openDrivePicker } from "@/lib/drivePicker";
import { useUiStore } from "@/store";
import { trpc } from "@/trpc";

export function ScopePicker({ tenantId, source }: { tenantId: string; source: Source }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const draft = useUiStore((s) => s.scopeDraft);
  const setDraft = useUiStore((s) => s.setScopeDraft);
  const toggleLabel = useUiStore((s) => s.toggleScopeLabel);

  const connections = trpc.connections.list.useQuery({ tenantId });
  const labels = trpc.connections.browseScope.useQuery(
    { tenantId, source },
    // Drive has no server-side listing to fetch; asking for one would be a guaranteed 400.
    { enabled: source === "gmail" },
  );
  const config = trpc.config.google.useQuery(undefined, { enabled: source === "drive" });

  const setScope = trpc.connections.setScope.useMutation({
    onSuccess: async () => {
      await utils.connections.list.invalidate({ tenantId });
      // `navigate` returns a promise in react-router 7; nothing here waits on the
      // transition, and the component unmounts when it lands.
      void navigate(divisionPath("sources", tenantId));
    },
  });

  // Seed the draft from what is already stored, once the grants arrive. An admin changing a
  // selection should see what they chose last time, not an empty form that silently means
  // "everything".
  const current = connections.data?.find((c) => c.source === source);
  useEffect(() => {
    if (current === undefined) return;
    setDraft({
      source,
      labels: current.config.labels ?? [],
      files: (current.config.folderIds ?? []).map((id) => ({ id, name: id, kind: "folder" })),
    });
  }, [current, source, setDraft]);

  if (connections.isPending || (source === "gmail" && labels.isPending)) {
    return <Skeleton rows={4} />;
  }

  if (connections.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live>
        {t("sources.notLoaded")}
      </Errata>
    );
  }

  const chosenLabels = draft?.source === source ? draft.labels : [];
  const chosenFiles = draft?.source === source ? draft.files : [];

  const save = () => {
    setScope.mutate({
      tenantId,
      source,
      selection:
        source === "gmail"
          ? {
              labels: chosenLabels.map((name) => ({
                id: labels.data?.items.find((i) => i.name === name)?.id ?? name,
                name,
              })),
            }
          : { files: chosenFiles },
    });
  };

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.sources")}</div>
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

      <div className="band-rule" />

      <div className="head">{SOURCE_LABEL[source]}</div>
      <div className="body stack">
        {source === "gmail" ? (
          labels.isError ? (
            <Errata heading={t("common.notLoaded")} live>
              {labels.error.message}
            </Errata>
          ) : (labels.data?.items.length ?? 0) === 0 ? (
            <p className="note">{t("scopePicker.nothingToChoose")}</p>
          ) : (
            <fieldset className="stack">
              <legend>{t("scopePicker.labelsHead")}</legend>
              {labels.data?.items.map((label) => (
                <label key={label.id} className="choice">
                  <input
                    type="checkbox"
                    checked={chosenLabels.includes(label.name)}
                    onChange={() => {
                      toggleLabel(source, label.name);
                    }}
                  />
                  <span>{label.name}</span>
                </label>
              ))}
            </fieldset>
          )
        ) : (
          <>
            <button
              type="button"
              className="action"
              disabled={config.data === undefined || config.data === null}
              onClick={() => {
                // Null when no ingestion client is configured; the button is disabled then,
                // and this guard is what makes that a type-level fact rather than a habit.
                const picker = config.data;
                if (picker === undefined || picker === null) return;
                void openDrivePicker(picker, (picked) => {
                  setDraft({ source, labels: [], files: picked });
                });
              }}
            >
              {t("scopePicker.pickFromDrive")}
            </button>
            {config.isError ? (
              <p className="note">{t("scopePicker.pickerUnavailable")}</p>
            ) : (
              <ul className="list">
                {chosenFiles.map((file) => (
                  <li key={file.id}>{file.name}</li>
                ))}
              </ul>
            )}
          </>
        )}

        {setScope.isError ? (
          <Errata heading={t("scopePicker.notSaved")} live>
            {setScope.error.message}
          </Errata>
        ) : null}

        <button
          type="button"
          className="action action--primary"
          disabled={setScope.isPending}
          onClick={save}
        >
          {setScope.isPending ? t("scopePicker.saving") : t("scopePicker.save")}
        </button>
      </div>
    </div>
  );
}
