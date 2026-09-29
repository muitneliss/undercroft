/**
 * The "when" column of a granted source: how often, what happened last, what happens next.
 *
 * Extracted from `ConnectionCard` because it is the one column that changed when the
 * ledger arrived. The card used to print "Syncing on schedule" here with nothing behind it;
 * now every line is a fact the server holds -- the cadence an admin chose, the newest run's
 * outcome and count, the instant the next one is due -- and an absent fact renders as
 * absent rather than as reassurance.
 *
 * Each schedule is a `<select>` for an admin and a word for everyone else (`ScheduleControl`).
 * There are two: how often the source syncs, and -- for a source whose lists are read through a
 * change filter -- how often it re-syncs in full, off until an admin opts in (ADR 0081). The
 * re-sync row also says when the last full re-sync finished and, when one spans more than a day
 * of the provider's requests, how many days it takes.
 *
 * Running is a state, not a spinner. The mark is the half-printed pending geometry and the
 * word says so; the list behind this card polls while it is true, so the mark flips on its
 * own when the run ends.
 */

import { useTranslation } from "react-i18next";

import type { Connection } from "@/api/types.ts";
import { type ScheduleEdit, ScheduleControl } from "@/components/ScheduleControl.tsx";
import { StatusMark } from "@/components/StatusMark.tsx";
import { type CadenceChoice, describeCadence, describeResync } from "@/lib/cadence.ts";
import { formatCount } from "@/lib/money.ts";
import { nextRunNote, runMark, runMarkLabel } from "@/lib/runs.ts";
import { expiryNote, relativeTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";

export function GrantWhen({
  tenantId,
  connection,
  canEdit,
  busy,
  saving,
  onCadence,
  resyncSaving,
  onResync,
}: {
  /** Whose schedule this is: a cron draft belongs to one tenant's card and no other's. */
  tenantId: string;
  connection: Connection;
  /** Whether the reader may change the schedules. Courtesy; the server refuses regardless. */
  canEdit: boolean;
  busy: boolean;
  /** Whether the cadence chosen here is on its way to the server. */
  saving: boolean;
  onCadence: (choice: CadenceChoice) => void;
  /** Whether the re-sync chosen here is on its way to the server. */
  resyncSaving: boolean;
  onResync: (choice: CadenceChoice) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const run = connection.lastRun;
  const status = run?.status ?? null;
  const sync: ScheduleEdit = {
    schedule: "sync",
    value: { cadence: connection.cadence, cron: connection.cron },
    label: t("grant.cadenceLabel"),
    describe: (cadence) => describeCadence(t, cadence),
    onChoose: onCadence,
  };

  return (
    <>
      <span className="label">{t("grant.schedule")}</span>
      <Schedule
        tenantId={tenantId}
        source={connection.source}
        edit={sync}
        canEdit={canEdit}
        busy={busy}
        saving={saving}
      />
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

      <Resync
        tenantId={tenantId}
        connection={connection}
        canEdit={canEdit}
        busy={busy}
        saving={resyncSaving}
        onResync={onResync}
      />
    </>
  );
}

/** One schedule: the control for an admin, the words -- and a custom expression -- for anyone else. */
function Schedule({
  tenantId,
  source,
  edit,
  canEdit,
  busy,
  saving,
}: {
  tenantId: string;
  source: string;
  edit: ScheduleEdit;
  canEdit: boolean;
  busy: boolean;
  saving: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (canEdit) {
    return (
      <ScheduleControl
        tenantId={tenantId}
        source={source}
        edit={edit}
        busy={busy}
        saving={saving}
      />
    );
  }
  return (
    <>
      <span className="datum datum--quiet">{edit.describe(edit.value.cadence)}</span>
      {edit.value.cron === null ? null : (
        <span className="datum datum--quiet grant__run">
          <code className="mono">{edit.value.cron}</code>
          <span>{t("grant.cronZone")}</span>
        </span>
      )}
    </>
  );
}

/**
 * The full re-sync, for a source that has one (ADR 0081): its schedule, what it is for, when the
 * last one finished, and -- when one needs more than a day of the provider's requests -- how many
 * days it takes. Nothing at all for a source whose lists no change filter reads.
 */
function Resync({
  tenantId,
  connection,
  canEdit,
  busy,
  saving,
  onResync,
}: {
  tenantId: string;
  connection: Connection;
  canEdit: boolean;
  busy: boolean;
  saving: boolean;
  onResync: (choice: CadenceChoice) => void;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const { resync } = connection;
  if (resync === null) {
    return null;
  }
  const edit: ScheduleEdit = {
    schedule: "resync",
    value: { cadence: resync.cadence, cron: resync.cron },
    label: t("grant.resyncLabel"),
    describe: (cadence) => describeResync(t, cadence),
    onChoose: onResync,
  };

  return (
    <>
      <span className="label">{t("grant.resync")}</span>
      <Schedule
        tenantId={tenantId}
        source={connection.source}
        edit={edit}
        canEdit={canEdit}
        busy={busy}
        saving={saving}
      />
      {saving ? (
        <span className="datum datum--quiet" role="status">
          {t("grant.resyncSaving")}
        </span>
      ) : null}
      <span className="datum datum--quiet">
        {resync.lastWholeReadAt === null
          ? t("grant.resyncNever")
          : t("grant.resyncLast", { when: relativeTime(resync.lastWholeReadAt, locale) })}
      </span>
      {resync.days !== null && resync.days > 1 && resync.budget !== null ? (
        <p className="note">
          {t("grant.resyncDays", {
            count: resync.days,
            budget: formatCount(resync.budget, locale),
          })}
        </p>
      ) : null}
      <p className="field__hint">{t("grant.resyncHint")}</p>
    </>
  );
}
