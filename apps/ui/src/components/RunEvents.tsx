/**
 * What the worker said while the run was running, in order.
 *
 * The one thing on the journal that answers "is anything happening". A run's counts are
 * deliberately withheld until it closes -- a count that is still changing is not a count --
 * which left an ingest that reads a mailbox for twenty minutes showing a dash in every
 * column and nothing else. This is what fills that silence, and it is also what a green run
 * that landed nothing now has to say for itself afterwards.
 *
 * Drawn from rows the leaf already holds, like `StepsTable` beside it: the query lives in
 * `RunDetail`, which is the one place that knows whether the run is still live and therefore
 * whether to keep re-reading. The sentences are `eventSentence`'s and the catalogue's.
 */

import type { Locale } from "@undercroft/core/locale";
import { useTranslation } from "react-i18next";

import type { RunEventView } from "@/api/types.ts";
import { eventSentence } from "@/lib/runs.ts";
import { formatTime } from "@/lib/when.ts";

export function RunEvents({
  events,
  locale,
  live,
}: {
  events: readonly RunEventView[];
  locale: Locale;
  /** Whether the run is still going, which is the only time this table announces itself. */
  live: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <table className="table">
      <caption>{t("journal.feedHead")}</caption>
      <thead>
        <tr>
          <th scope="col">{t("journal.colWhen2")}</th>
          <th scope="col">{t("journal.colWhat2")}</th>
        </tr>
      </thead>
      {/* A live region only while the run is live: a closed run's feed is history, and
          announcing it again on every render would talk over the reader. */}
      <tbody aria-live={live ? "polite" : "off"}>
        {events.map((event) => (
          <tr key={`${event.at}/${event.event}/${event.entity ?? ""}`}>
            <td className="datum datum--quiet">{formatTime(event.at, locale)}</td>
            <td>{eventSentence(t, locale, event)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
