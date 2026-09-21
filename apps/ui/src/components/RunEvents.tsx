/**
 * The ledger: what the run said HAPPENED, in order.
 *
 * A run's counts are deliberately withheld until it closes -- a count that is still changing
 * is not a count -- which left an ingest that reads a mailbox for twenty minutes showing a
 * dash in every column and nothing else. This is what fills that silence, and it is also what
 * a green run that landed nothing has to say for itself afterwards.
 *
 * READINGS ARE NOT ENTRIES, and that is the whole shape of this file now. "Read 928 of 7,786"
 * is the current value of a dial: the next one replaces it rather than joining it, so it is
 * the gauge above this (`RunProgress`) and never a line in here. Printing them as lines gave
 * one leaf a hundred and eighty copies of one sentence, buried the counts and the refusals
 * beneath them, and -- through the `aria-live` this table still carries -- read a new one
 * aloud every two seconds. `runFeed.ts` sorts the two apart, once, in `RunDetail`, which is
 * also where the query lives. ADR 0032.
 *
 * IT IS BOUNDED AND IT FOLLOWS THE TAIL. A ledger is read at its open end: the region holds a
 * fixed run of lines and stays at the newest while a run is live, but stops following the
 * moment a reader scrolls back, because a page that snaps away mid-sentence is worse than one
 * that needs a scroll. Whether it is pinned is a fact about a scroll container rather than
 * application state, so it lives in a ref -- `.claude/rules/state.md` allows exactly that.
 *
 * A CORRECTION READS AS ONE. A `warn` or an `error` is usually the reason somebody opened this
 * leaf, and it used to be set in the same ink as "started reading messages". It now carries a
 * status mark and its own ink, the same two carriers -- geometry first, hue last -- every
 * other state in this interface uses.
 */

import type { Locale } from "@undercroft/core/locale";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { RunEventView } from "@/api/types.ts";
import { MarkLapsed, MarkPending } from "@/components/Icon.tsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { eventSentence } from "@/lib/runs.ts";
import { formatTime } from "@/lib/when.ts";

/**
 * How near the foot still counts as being at the foot.
 *
 * A line is a little over 2rem, so one line's worth of slack is a reader still watching the
 * open end rather than one who has gone back to read something.
 */
const AT_THE_FOOT_PX = 40;

/** The mark a level wears, where a level is worth marking at all. */
const GLYPH = { warn: MarkPending, error: MarkLapsed } as const;

function Level({ level }: { level: RunEventView["level"] }): React.JSX.Element | null {
  if (level === "info") {
    return null;
  }
  const Glyph = GLYPH[level];
  // `aria-hidden` by the same argument `StatusMark` makes: the sentence beside it already says
  // what happened, and a screen reader hearing "warning" before it would hear the fact twice.
  return (
    <span className="feed__mark" aria-hidden="true">
      <Glyph size={13} />
    </span>
  );
}

/**
 * Keep the region at its open end while the run writes to it, and let go when the reader looks
 * back. Returns what the scroll container needs: a ref, and the handler that watches it.
 */
function useTail(lines: number): {
  regionRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
} {
  const regionRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  function onScroll(): void {
    const el = regionRef.current;
    if (el !== null) {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_THE_FOOT_PX;
    }
  }

  useEffect(() => {
    const el = regionRef.current;
    if (el !== null && pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  return { regionRef, onScroll };
}

export function RunEvents({
  entries,
  locale,
  live,
}: {
  entries: readonly RunEventView[];
  locale: Locale;
  /** Whether the run is still going, which is the only time this table announces itself. */
  live: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { regionRef, onScroll } = useTail(entries.length);

  return (
    <div className="feed stack stack--tight">
      <p className="feed__head">
        <span className="label">{t("journal.feedHead")}</span>
        <span className="datum datum--quiet">
          {t("journal.feedCount", { count: entries.length })}
        </span>
      </p>

      {entries.length === 0 ? (
        <p className="note">{t("journal.feedEmpty")}</p>
      ) : (
        <div className="feed__region" ref={regionRef} onScroll={onScroll}>
          <Table>
            {/* The head is printed above the region, with the count beside it; this is the
                same words for a reader who meets the table on its own. */}
            <TableCaption className="visually-hidden">{t("journal.feedHead")}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("journal.colWhen2")}</TableHead>
                <TableHead scope="col">{t("journal.colWhat2")}</TableHead>
              </TableRow>
            </TableHeader>
            {/* A live region only while the run is live: a closed run's feed is history, and
                announcing it again on every render would talk over the reader. */}
            <TableBody aria-live={live ? "polite" : "off"}>
              {entries.map((event) => (
                <TableRow
                  key={`${event.at}/${event.event}/${event.entity ?? ""}`}
                  className={`feed__line feed__line--${event.level}`}
                >
                  <TableCell className="datum datum--quiet">
                    {formatTime(event.at, locale)}
                  </TableCell>
                  <TableCell className="feed__what">
                    <Level level={event.level} />
                    {eventSentence(t, locale, event)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
