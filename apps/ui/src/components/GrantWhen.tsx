/**
 * The "when" column of a granted source: how often, what happened last, what happens next.
 *
 * Extracted from `ConnectionCard` because it is the one column that changed when the
 * ledger arrived. The card used to print "Syncing on schedule" here with nothing behind it;
 * now every line is a fact the server holds -- the cadence an admin chose, the newest run's
 * outcome and count, the instant the next one is due -- and an absent fact renders as
 * absent rather than as reassurance.
 *
 * The cadence is a `<select>` for an admin and a word for everyone else. A PRESET saves on
 * change: there is one field, so a Save plate would be a second step for a decision already
 * made. "Custom (cron)" does not, because choosing it is the start of a decision rather than
 * the end of one: it opens a field for the expression, with Save beside it and, below it, the
 * next three instants the expression fires at, in Singapore time. Those dates are the
 * confirmation -- there is deliberately no sentence paraphrasing the cron (ADR 0059) -- and
 * while the expression cannot be kept, the refusal stands where they would and Save is off.
 *
 * What the select shows is derived, never stored twice: the server's cadence, or "custom"
 * while this card holds a draft in the store (`cronDraft`). So choosing a preset after
 * starting a draft drops the draft, and the select falls back to what the server holds.
 *
 * Running is a state, not a spinner. The mark is the half-printed pending geometry and the
 * word says so; the list behind this card polls while it is true, so the mark flips on its
 * own when the run ends.
 */

import { useTranslation } from "react-i18next";

import type { Connection } from "@/api/types.ts";
import { StatusMark } from "@/components/StatusMark.tsx";
import {
  type CadenceChoice,
  CADENCES,
  describeCadence,
  isPresetCadence,
  previewCron,
  TICK_MINUTES,
} from "@/lib/cadence.ts";
import { formatCount } from "@/lib/money.ts";
import { nextRunNote, runMark, runMarkLabel } from "@/lib/runs.ts";
import { expiryNote, relativeTime } from "@/lib/when.ts";
import { cronDraftFor, useUiStore } from "@/store.ts";

export function GrantWhen({
  tenantId,
  connection,
  canEdit,
  busy,
  saving,
  onCadence,
}: {
  /** Whose schedule this is: a cron draft belongs to one tenant's card and no other's. */
  tenantId: string;
  connection: Connection;
  /** Whether the reader may change the cadence. Courtesy; the server refuses regardless. */
  canEdit: boolean;
  busy: boolean;
  /** Whether the cadence chosen here is on its way to the server. */
  saving: boolean;
  onCadence: (choice: CadenceChoice) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const run = connection.lastRun;
  const status = run?.status ?? null;

  return (
    <>
      <span className="label">{t("grant.schedule")}</span>
      {canEdit ? (
        <CadenceControl
          tenantId={tenantId}
          connection={connection}
          busy={busy}
          saving={saving}
          onCadence={onCadence}
        />
      ) : (
        <>
          <span className="datum datum--quiet">{describeCadence(t, connection.cadence)}</span>
          {connection.cron === null ? null : (
            <span className="datum datum--quiet grant__run">
              <code className="mono">{connection.cron}</code>
              <span>{t("grant.cronZone")}</span>
            </span>
          )}
        </>
      )}
      {saving ? (
        <span className="datum datum--quiet" role="status">
          {t("grant.cadenceSaving")}
        </span>
      ) : null}

      <span className="label">{t("grant.lastRun")}</span>
      <span className="datum datum--quiet grant__run">
        <StatusMark mark={runMark(status)} label={runMarkLabel(t, status)} />
        {run !== null && status !== "running" ? (
          <span>{relativeTime(run.startedAt, locale)}</span>
        ) : null}
        {run !== null && status === "ok" ? (
          <span>
            {t("run.landed", { count: run.seen, countText: formatCount(run.seen, locale) })}
          </span>
        ) : null}
      </span>

      <span className="label">{t("grant.nextRun")}</span>
      <span className="datum datum--quiet">{nextRunNote(t, locale, connection)}</span>
      <span className="datum datum--quiet">{expiryNote(t, connection.expiresAt)}</span>
    </>
  );
}

/** An admin's select, and -- while it reads "custom" -- the expression field under it. */
function CadenceControl({
  tenantId,
  connection,
  busy,
  saving,
  onCadence,
}: {
  tenantId: string;
  connection: Connection;
  busy: boolean;
  saving: boolean;
  onCadence: (choice: CadenceChoice) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const draft = useUiStore((state) => cronDraftFor(state, tenantId, connection.source));
  const setCronDraft = useUiStore((state) => state.setCronDraft);
  const dropCronDraft = useUiStore((state) => state.dropCronDraft);
  const selected = draft === null ? connection.cadence : "custom";

  return (
    <>
      <select
        aria-label={t("grant.cadenceLabel")}
        aria-busy={saving}
        className="input input--select"
        disabled={busy}
        value={selected}
        onChange={(event): void => {
          const chosen = event.target.value;
          if (chosen === "custom") {
            // Seeded with what is stored, so reopening a custom schedule edits it rather than
            // starting from nothing.
            setCronDraft(tenantId, connection.source, connection.cron ?? "");
            return;
          }
          if (!isPresetCadence(chosen)) {
            return;
          }
          dropCronDraft(tenantId, connection.source);
          if (chosen !== connection.cadence) {
            onCadence({ cadence: chosen });
          }
        }}
      >
        {CADENCES.map((cadence) => (
          <option key={cadence} value={cadence}>
            {describeCadence(t, cadence)}
          </option>
        ))}
      </select>
      {selected === "custom" ? (
        <CronField
          tenantId={tenantId}
          connection={connection}
          expression={draft ?? connection.cron ?? ""}
          busy={busy}
          onCadence={onCadence}
        />
      ) : null}
    </>
  );
}

/** The expression, its Save, and what it will do: the next fires, or why it cannot be kept. */
function CronField({
  tenantId,
  connection,
  expression,
  busy,
  onCadence,
}: {
  tenantId: string;
  connection: Connection;
  expression: string;
  busy: boolean;
  onCadence: (choice: CadenceChoice) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const setCronDraft = useUiStore((state) => state.setCronDraft);
  const preview = previewCron(t, locale, expression);
  const fieldId = `cron-${connection.source}`;
  const hintId = `${fieldId}-hint`;
  const reasonId = `${fieldId}-reason`;
  // Saving what is already stored would be a write, an audit row and a refetch that change
  // nothing; the plate stays off until there is something to save.
  const unchanged =
    preview.state === "ok" && connection.cadence === "custom" && preview.cron === connection.cron;

  return (
    <div className="stack stack--tight">
      {/* `row row--field`, never a bare `.row`: the row holds a `.field` (ADR 0027). */}
      <div className="row grant__cron row--field">
        <label className="field" htmlFor={fieldId}>
          <span className="label">{t("grant.cronLabel")}</span>
          <input
            aria-describedby={preview.state === "refused" ? `${hintId} ${reasonId}` : hintId}
            autoComplete="off"
            className="input mono"
            disabled={busy}
            id={fieldId}
            placeholder="30 7 * * 1-5"
            spellCheck={false}
            type="text"
            value={expression}
            onChange={(event): void => {
              setCronDraft(tenantId, connection.source, event.target.value);
            }}
          />
        </label>
        <button
          className="plate plate--primary"
          disabled={busy || preview.state !== "ok" || unchanged}
          type="button"
          onClick={(): void => {
            if (preview.state === "ok") {
              onCadence({ cadence: "custom", cron: preview.cron });
            }
          }}
        >
          {t("grant.cronSave")}
        </button>
      </div>
      <p className="field__hint" id={hintId}>
        {t("grant.cronHint", { minutes: TICK_MINUTES })}
      </p>
      {/* Described by the field rather than announced: a live region here would speak at every
          keystroke of an expression that is invalid until its last character. */}
      {preview.state === "refused" ? (
        <p className="note" id={reasonId}>
          {preview.reason}
        </p>
      ) : null}
      {preview.state === "ok" ? (
        <>
          <span className="label">{t("grant.cronPreview")}</span>
          <ol className="grant__fires stack stack--tight">
            {preview.fires.map((fire) => (
              <li className="datum datum--quiet" key={fire}>
                {fire}
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </div>
  );
}
