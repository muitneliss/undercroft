/**
 * One schedule of a card, as an admin edits it: a `<select>` of the cadences and, while it reads
 * "custom", the cron field under it.
 *
 * Split from `GrantWhen` when a card grew a second schedule -- how often it re-syncs in full
 * beside how often it syncs (ADR 0082) -- so both are written with the same control and a custom
 * re-sync is previewed and refused exactly as a custom sync is. `ScheduleEdit` is the one thing
 * that differs: which schedule, what the server holds for it, and how its choices read.
 *
 * A PRESET saves on change: there is one field, so a Save plate would be a second step for a
 * decision already made. "Custom (cron)" does not, because choosing it is the start of a
 * decision rather than the end of one: it opens a field for the expression, with Save beside it
 * and, below it, the next three instants the expression fires at, in Singapore time. Those dates
 * are the confirmation -- there is deliberately no sentence paraphrasing the cron (ADR 0059).
 *
 * What the select shows is derived, never stored twice: the server's value, or "custom" while
 * this schedule holds a draft in the store (`cronDraft`).
 */

import { useTranslation } from "react-i18next";

import {
  type Cadence,
  type CadenceChoice,
  CADENCES,
  isPresetCadence,
  previewCron,
  TICK_MINUTES,
} from "@/lib/cadence.ts";
import { type CronSchedule, cronDraftFor, useUiStore } from "@/store.ts";

/**
 * One of a card's two schedules as a control edits it: how often it syncs, or how often it
 * re-syncs in full (ADR 0082). The same select and the same cron field serve both, so a custom
 * re-sync is written, previewed and refused exactly as a custom sync is.
 */
export interface ScheduleEdit {
  readonly schedule: CronSchedule;
  /** What the server holds for this schedule. */
  readonly value: { readonly cadence: Cadence; readonly cron: string | null };
  /** The select's accessible name. */
  readonly label: string;
  /** How each choice reads in the select. */
  readonly describe: (cadence: Cadence) => string;
  readonly onChoose: (choice: CadenceChoice) => void;
}

/** An admin's select, and -- while it reads "custom" -- the expression field under it. */
export function ScheduleControl({
  tenantId,
  source,
  edit,
  busy,
  saving,
}: {
  tenantId: string;
  source: string;
  edit: ScheduleEdit;
  busy: boolean;
  saving: boolean;
}): React.JSX.Element {
  const draft = useUiStore((state) => cronDraftFor(state, tenantId, source, edit.schedule));
  const setCronDraft = useUiStore((state) => state.setCronDraft);
  const dropCronDraft = useUiStore((state) => state.dropCronDraft);
  const selected = draft === null ? edit.value.cadence : "custom";

  return (
    <>
      <select
        aria-label={edit.label}
        aria-busy={saving}
        className="input input--select"
        disabled={busy}
        value={selected}
        onChange={(event): void => {
          const chosen = event.target.value;
          if (chosen === "custom") {
            // Seeded with what is stored, so reopening a custom schedule edits it rather than
            // starting from nothing.
            setCronDraft(tenantId, source, edit.schedule, edit.value.cron ?? "");
            return;
          }
          if (!isPresetCadence(chosen)) {
            return;
          }
          dropCronDraft(tenantId, source, edit.schedule);
          if (chosen !== edit.value.cadence) {
            edit.onChoose({ cadence: chosen });
          }
        }}
      >
        {CADENCES.map((cadence) => (
          <option key={cadence} value={cadence}>
            {edit.describe(cadence)}
          </option>
        ))}
      </select>
      {selected === "custom" ? (
        <CronField
          tenantId={tenantId}
          source={source}
          edit={edit}
          expression={draft ?? edit.value.cron ?? ""}
          busy={busy}
        />
      ) : null}
    </>
  );
}

/** The expression, its Save, and what it will do: the next fires, or why it cannot be kept. */
function CronField({
  tenantId,
  source,
  edit,
  expression,
  busy,
}: {
  tenantId: string;
  source: string;
  edit: ScheduleEdit;
  expression: string;
  busy: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const setCronDraft = useUiStore((state) => state.setCronDraft);
  const preview = previewCron(t, locale, expression);
  // The schedule is in the id: a card holds two of these, and a label must point at its own.
  const fieldId = `cron-${edit.schedule}-${source}`;
  const hintId = `${fieldId}-hint`;
  const reasonId = `${fieldId}-reason`;
  // Saving what is already stored would be a write, an audit row and a refetch that change
  // nothing; the plate stays off until there is something to save.
  const unchanged =
    preview.state === "ok" && edit.value.cadence === "custom" && preview.cron === edit.value.cron;

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
              setCronDraft(tenantId, source, edit.schedule, event.target.value);
            }}
          />
        </label>
        <button
          className="plate plate--primary"
          disabled={busy || preview.state !== "ok" || unchanged}
          type="button"
          onClick={(): void => {
            if (preview.state === "ok") {
              edit.onChoose({ cadence: "custom", cron: preview.cron });
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
