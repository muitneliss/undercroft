/**
 * Choosing what a connected source will sync.
 *
 * A side panel, not a modal. Modals are usually the lazy first thought; this is
 * a task with real content that someone may want to check against another tab,
 * and trapping focus over the rest of the app buys nothing here.
 *
 * Drive is the case that matters. An unscoped Drive sync copies **everything the
 * credential can reach** into a create-only lake that cannot un-copy it, so the
 * form refuses to save without at least one folder — the same refusal the API
 * and `DriveSource` both make. Three layers, because the consequence is
 * permanent.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "@/api/client";
import type { Source } from "@/api/types";
import { SOURCE_LABEL } from "@/api/types";

const ENTITY_CHOICES: Partial<Record<Source, string[]>> = {
  hubspot: ["companies", "contacts", "deals", "associations"],
  xero: ["contacts", "invoices", "payments", "credit_notes"],
};

export function ScopePanel({ tenantId, source }: { tenantId: string; source: Source }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [folders, setFolders] = useState("");
  const [labels, setLabels] = useState("");
  const [entities, setEntities] = useState<string[]>(ENTITY_CHOICES[source] ?? []);
  const [schedule, setSchedule] = useState("0 2 * * *");

  const save = useMutation({
    mutationFn: () =>
      api.saveConfig(tenantId, source, {
        folder_ids: folders
          .split(/[\s,]+/)
          .map((f) => f.trim())
          .filter(Boolean),
        labels: labels
          .split(/[\s,]+/)
          .map((l) => l.trim())
          .filter(Boolean),
        entities,
        schedule_cron: schedule,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["connections", tenantId] });
      // react-router 7 returns void | Promise<void>; we are not waiting on the
      // transition, and `void` says so rather than leaving a floating promise.
      void navigate(`/tenants/${tenantId}`);
    },
  });

  const folderList = folders.split(/[\s,]+/).filter(Boolean);
  const driveNeedsFolders = source === "drive" && folderList.length === 0;

  return (
    <div className="panel stack">
      <div>
        <h2>What should we sync from {SOURCE_LABEL[source]}?</h2>
        <p className="page-header__sub">
          You can change this at any time. Nothing outside what you choose here is read.
        </p>
      </div>

      {source === "drive" ? (
        <div className="field">
          <label className="field__label" htmlFor="folders">
            Drive folders
          </label>
          <input
            id="folders"
            className="input"
            value={folders}
            onChange={(e) => setFolders(e.target.value)}
            placeholder="Paste one or more folder IDs"
            aria-describedby="folders-hint"
          />
          <span id="folders-hint" className="field__hint">
            Only PDFs inside these folders are copied — and their subfolders. Nothing else in
            your Drive is read. A folder ID is the last part of its URL.
          </span>
        </div>
      ) : null}

      {source === "gmail" ? (
        <div className="field">
          <label className="field__label" htmlFor="labels">
            Gmail labels
          </label>
          <input
            id="labels"
            className="input"
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            placeholder="INBOX"
            aria-describedby="labels-hint"
          />
          <span id="labels-hint" className="field__hint">
            Leave blank to read the whole mailbox. Only message headers and PDF attachments
            are stored.
          </span>
        </div>
      ) : null}

      {ENTITY_CHOICES[source] ? (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label">Records to sync</legend>
          {ENTITY_CHOICES[source]?.map((entity) => (
            <label key={entity} className="row" style={{ gap: "var(--space-2)" }}>
              <input
                type="checkbox"
                checked={entities.includes(entity)}
                onChange={(e) =>
                  setEntities((current) =>
                    e.target.checked
                      ? [...current, entity]
                      : current.filter((x) => x !== entity),
                  )
                }
              />
              {entity}
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="field">
        <label className="field__label" htmlFor="schedule">
          Sync schedule
        </label>
        <input
          id="schedule"
          className="input"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          aria-describedby="schedule-hint"
        />
        <span id="schedule-hint" className="field__hint">
          Cron, in Asia/Singapore. <code>0 2 * * *</code> is 2am daily.
        </span>
      </div>

      {driveNeedsFolders ? (
        <p className="field__hint" role="status">
          Choose at least one folder. Without one we would have to read your entire Drive,
          and we will not do that.
        </p>
      ) : null}

      {save.isError ? (
        <p className="error-text" role="alert">
          {save.error instanceof ApiError && save.error.detail
            ? save.error.detail
            : "Could not save."}
        </p>
      ) : null}

      <div className="row">
        <button
          className="btn btn--primary"
          onClick={() => save.mutate()}
          disabled={save.isPending || driveNeedsFolders}
        >
          {save.isPending ? "Saving…" : "Save and finish"}
        </button>
        <button className="btn" onClick={() => void navigate(`/tenants/${tenantId}`)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
