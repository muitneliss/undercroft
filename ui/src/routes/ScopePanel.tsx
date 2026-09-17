/**
 * Choosing what a granted source will sync: the leaf hinged down over its row.
 *
 * Not a modal, and not a side panel either. `.claude/rules/ui.md` ruled out the
 * modal -- this is a task with real content someone may want to check against
 * another tab, and trapping focus over the rest of the app buys nothing. In this
 * world the alternative is better than a side panel: the leaf turns down inside
 * its own row, so the schedule above and below stays on screen, in the document
 * and in the tab order, and the section board shows through the acetate at the
 * alpha `@/lib/acetate` solved for this division.
 *
 * Drive is the case that matters. An unscoped Drive sync copies **everything the
 * credential can reach** into a create-only lake that cannot un-copy it, so the
 * form refuses to save without at least one folder -- the same refusal the API
 * and `DriveSource` both make. Three layers, because the consequence is
 * permanent.
 *
 * The checkboxes are punches. Selection is a hole through the leaf everywhere
 * else in this system, so it is a hole here too; underneath it is an ordinary
 * `<input type="checkbox">` with its own focus ring, because the metaphor is not
 * allowed to cost anyone a keyboard.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "@/api/client";
import type { Source } from "@/api/types";
import { SOURCE_LABEL } from "@/api/types";
import { Errata } from "@/components/Errata";
import { ArrowRight } from "@/components/Icon";

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
  const choices = ENTITY_CHOICES[source];

  return (
    <section className="hinge stack" aria-label={`What to sync from ${SOURCE_LABEL[source]}`}>
      <span className="hinge__punch hinge__punch--a" aria-hidden="true" />
      <span className="hinge__punch hinge__punch--b" aria-hidden="true" />
      <div className="stack stack--tight">
        <h3>What should we sync from {SOURCE_LABEL[source]}?</h3>
        <p className="note">
          You can change this at any time. Nothing outside what you choose here is read.
        </p>
      </div>

      {source === "drive" ? (
        <div className="field">
          <label className="label" htmlFor="folders">
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
          <label className="label" htmlFor="labels">
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

      {choices ? (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Records to sync</legend>
          {choices.map((entity) => (
            <label key={entity} className="punch">
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
              <span className="punch__box" aria-hidden="true" />
              {entity}
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="field">
        <label className="label" htmlFor="schedule">
          Sync schedule
        </label>
        <input
          id="schedule"
          className="input"
          style={{ maxWidth: "14rem" }}
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          aria-describedby="schedule-hint"
        />
        <span id="schedule-hint" className="field__hint">
          Cron, in Asia/Singapore. <code>0 2 * * *</code> is 2am daily.
        </span>
      </div>

      {driveNeedsFolders ? (
        <p className="note" role="status">
          Choose at least one folder. Without one we would have to read your entire Drive,
          and we will not do that.
        </p>
      ) : null}

      {save.isError ? (
        <Errata heading="Not saved" live>
          {save.error instanceof ApiError && save.error.detail
            ? save.error.detail
            : "This scope could not be saved. Nothing has been changed."}
        </Errata>
      ) : null}

      <div className="row">
        <button
          className="plate plate--primary"
          onClick={() => save.mutate()}
          disabled={save.isPending || driveNeedsFolders}
        >
          {save.isPending ? "Saving…" : "Save and finish"}
          {save.isPending ? null : <ArrowRight size={13} />}
        </button>
        <button className="plate" onClick={() => void navigate(`/tenants/${tenantId}`)}>
          Cancel
        </button>
      </div>
    </section>
  );
}
