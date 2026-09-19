/**
 * One line of the journal.
 *
 * Presentational: it is handed a run and says what the run did, how it ended and how much
 * it saw, in the reader's language. Whether the row is the open one is a fact of the URL
 * that the route passes down, and the leaf that opens beneath it is the route's to render --
 * this row only marks itself `aria-current` so a reader with a screen reader, or without
 * colour, knows which line the leaf belongs to.
 *
 * A run still in progress prints MISSING in every count. A number still changing is not a
 * number, and printing what has landed so far would be read as the total.
 */

import type { Locale } from "@undercroft/core/locale";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { RunView } from "@/api/types.ts";
import { StatusMark } from "@/components/StatusMark.tsx";
import { formatCount, MISSING } from "@/lib/money.ts";
import { describeRun, runMark, runMarkLabel, triggerLabel } from "@/lib/runs.ts";
import { formatDateTime, formatDuration, relativeTime } from "@/lib/when.ts";

export function RunRow({
  run,
  locale,
  open,
  href,
}: {
  run: RunView;
  locale: Locale;
  /** Whether this is the row whose leaf is hinged open beneath it. */
  open: boolean;
  /** Where the row opens: the journal at this run. */
  href: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { counts } = run;

  /** A figure, or MISSING for every figure while the run is still writing them. */
  function count(value: number): string {
    return counts === null ? MISSING : formatCount(value, locale);
  }

  return (
    <tr {...(open ? { "aria-current": "true" as const } : {})}>
      <td className="datum datum--quiet" title={formatDateTime(run.startedAt, locale)}>
        {relativeTime(run.startedAt, locale)}
      </td>
      <td>
        <Link className="journal__what" to={href}>
          {describeRun(t, run)}
        </Link>
        <span className="datum datum--quiet journal__trigger">{triggerLabel(t, run.trigger)}</span>
      </td>
      <td>
        <StatusMark mark={runMark(run.status)} label={runMarkLabel(t, run.status)} />
        {run.testsFailed !== null && run.testsFailed > 0 ? (
          <span className="datum datum--quiet journal__trigger">
            {t("journal.testsFailed", {
              count: run.testsFailed,
              countText: formatCount(run.testsFailed, locale),
            })}
          </span>
        ) : null}
      </td>
      <td className="num">{count(counts?.landed ?? 0)}</td>
      <td className="num">{count(counts?.created ?? 0)}</td>
      <td className="num">{count(counts?.changed ?? 0)}</td>
      <td className="num">{count(counts?.refused ?? 0)}</td>
      <td className="num datum datum--quiet">
        {formatDuration(run.startedAt, run.endedAt, locale)}
      </td>
    </tr>
  );
}
