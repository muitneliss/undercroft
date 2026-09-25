/**
 * The "when" column of a granted source: how often, what happened last, what happens next.
 *
 * Extracted from `ConnectionCard` because it is the one column that changed when the
 * ledger arrived. The card used to print "Syncing on schedule" here with nothing behind it;
 * now every line is a fact the server holds -- the cadence an admin chose, the newest run's
 * outcome and count, the instant the next one is due -- and an absent fact renders as
 * absent rather than as reassurance.
 *
 * The cadence is a `<select>` for an admin and a word for everyone else. Uncontrolled, keyed
 * by the stored value so a change from anywhere else remounts it (`DisplayNameForm` follows
 * the same idiom), and saved on change: there is one field, so a Save plate would be a
 * second step for a decision already made.
 *
 * Running is a state, not a spinner. The mark is the half-printed pending geometry and the
 * word says so; the list behind this card polls while it is true, so the mark flips on its
 * own when the run ends.
 */

import { useTranslation } from "react-i18next";

import type { Connection } from "@/api/types.ts";
import { StatusMark } from "@/components/StatusMark.tsx";
import { type Cadence, CADENCES, describeCadence, isCadence } from "@/lib/cadence.ts";
import { formatCount } from "@/lib/money.ts";
import { nextRunNote, runMark, runMarkLabel } from "@/lib/runs.ts";
import { expiryNote, relativeTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";

export function GrantWhen({
  connection,
  canEdit,
  busy,
  saving,
  onCadence,
}: {
  connection: Connection;
  /** Whether the reader may change the cadence. Courtesy; the server refuses regardless. */
  canEdit: boolean;
  busy: boolean;
  /** Whether the cadence chosen here is on its way to the server. */
  saving: boolean;
  onCadence: (cadence: Cadence) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const run = connection.lastRun;
  const status = run?.status ?? null;

  return (
    <>
      <span className="label">{t("grant.schedule")}</span>
      {canEdit ? (
        <select
          aria-label={t("grant.cadenceLabel")}
          aria-busy={saving}
          className="input input--select"
          defaultValue={connection.cadence}
          disabled={busy}
          key={connection.cadence}
          onChange={(event): void => {
            const chosen = event.target.value;
            if (isCadence(chosen) && chosen !== connection.cadence) {
              onCadence(chosen);
            }
          }}
        >
          {CADENCES.map((cadence) => (
            <option key={cadence} value={cadence}>
              {describeCadence(t, cadence)}
            </option>
          ))}
        </select>
      ) : (
        <span className="datum datum--quiet">{describeCadence(t, connection.cadence)}</span>
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
