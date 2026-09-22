/**
 * One line of the journal.
 *
 * Presentational: it is handed a run and says what the run did, how it ended and how much
 * it saw, in the reader's language. Whether the row is the open one is a fact of the URL
 * that the route passes down, and the leaf that opens beneath it is the route's to render --
 * this row only marks itself `aria-current` so a reader with a screen reader, or without
 * colour, knows which line the leaf belongs to.
 *
 * A run with no counts to give prints MISSING in every one of them: one still in progress,
 * because a number still changing is not a number and what has landed so far would be read
 * as the total, and a build, which lands no records at all. Which of them has counts is the
 * ledger's decision (`countsOf`, control-plane `services/runs.ts`), not this row's -- the row
 * prints the four figures or the four dashes.
 */

import type { Locale } from "@undercroft/core/locale";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { RunView } from "@/api/types.ts";
import { StatusMark } from "@/components/StatusMark.tsx";
import { TableCell, TableRow } from "@/components/ui/table.tsx";
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
    <TableRow {...(open ? { "aria-current": "true" as const } : {})}>
      <TableCell className="datum datum--quiet" title={formatDateTime(run.startedAt, locale)}>
        {relativeTime(run.startedAt, locale)}
      </TableCell>
      <TableCell>
        <Link className="journal__what" to={href}>
          {describeRun(t, run)}
        </Link>
        <span className="datum datum--quiet journal__trigger">{triggerLabel(t, run.trigger)}</span>
      </TableCell>
      <TableCell>
        <StatusMark mark={runMark(run.status)} label={runMarkLabel(t, run.status)} />
        {run.testsFailed !== null && run.testsFailed > 0 ? (
          <span className="datum datum--quiet journal__trigger">
            {t("journal.testsFailed", {
              count: run.testsFailed,
              countText: formatCount(run.testsFailed, locale),
            })}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="num">{count(counts?.landed ?? 0)}</TableCell>
      <TableCell className="num">{count(counts?.created ?? 0)}</TableCell>
      <TableCell className="num">{count(counts?.changed ?? 0)}</TableCell>
      <TableCell className="num">{count(counts?.refused ?? 0)}</TableCell>
      <TableCell className="num datum datum--quiet">
        {formatDuration(run.startedAt, run.endedAt, locale)}
      </TableCell>
    </TableRow>
  );
}
