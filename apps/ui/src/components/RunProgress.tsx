/**
 * The dials, while they are still moving: one standing line per entity the run is reading.
 *
 * This is the object the Journal was missing. A run's counts are withheld until it closes --
 * a count that is still changing is not a count -- and the feed beside this narrates what
 * HAPPENED, so an ingest reading a mailbox for three hours had nothing on the leaf that a
 * person could look at and see moving. It had two hundred printings of one sentence instead,
 * which is the same fact told badly enough to bury the rest of the page. ADR 0032.
 *
 * A LINE, NOT A CARD. Name, figure, share, and beneath them a rule inked as far as the work
 * has gone -- the way a printed schedule shows how much of a section has been set, and the
 * reason `.gathering` was in the sheet before anything used it. The rule is the only thing on
 * this leaf that moves without the reader doing something, and it earns that by being the one
 * question the leaf exists to answer: is this customer's data flowing, right now.
 *
 * NO BAR WITHOUT A DENOMINATOR. A connector that never states a total (`runPaths.ts` reads a
 * stream and counts as it goes) gets its count and a note saying the total is not known --
 * never a bar, whose full width would stand for a number nobody has told us. That bar is rule
 * 2 broken in pixels and it is the most convincing kind of guess, because it looks exactly
 * like a measurement.
 *
 * IT IS NOT A LIVE REGION. A `role="progressbar"` is readable on demand and does not
 * interrupt, which is what a figure changing every second should be. The ledger below keeps
 * `aria-live`, and now that readings are not entries it announces a milestone rather than a
 * new copy of the same sentence every couple of seconds.
 */

import type { Locale } from "@undercroft/core/locale";
import { useTranslation } from "react-i18next";

import { gaugeFigure, gaugeShare, gaugeWalk, type RunGauge } from "@/lib/runFeed.ts";

/**
 * The leader between the name and the figure, which is also the measurement.
 *
 * Inked as far as the work has gone where there is a fraction to ink, and a perforation
 * where there is not -- the same dashed hairline `.grant--pending` uses for a thing that has
 * not happened yet, so "no total was stated" and "this much is done" are told apart by the
 * rule itself rather than by the absence of one.
 */
function Leader({ share }: { share: number | null }): React.JSX.Element {
  if (share === null) {
    return <span className="gauge__unmeasured" aria-hidden="true" />;
  }
  return (
    <span className="gathering gauge__rule" aria-hidden="true">
      {/* Scaled rather than widened, so a reading every second cannot relayout the row. */}
      <span className="gathering__inked" style={{ transform: `scaleX(${share})` }} />
    </span>
  );
}

function Gauge({ gauge, locale }: { gauge: RunGauge; locale: Locale }): React.JSX.Element {
  const { t } = useTranslation();
  const figure = gaugeFigure(locale, gauge);
  // A share where there is a total; otherwise how far the walk has got, if the source says.
  const note = gaugeShare(t, locale, gauge) ?? gaugeWalk(t, locale, gauge);

  return (
    <div
      className="gauge"
      role="progressbar"
      aria-label={gauge.entity}
      aria-valuemin={0}
      aria-valuemax={gauge.total ?? undefined}
      aria-valuenow={gauge.read ?? undefined}
      aria-valuetext={t("journal.gauge.reading", { entity: gauge.entity, figure })}
    >
      <span className="gauge__name label">{gauge.entity}</span>
      <Leader share={gauge.share} />
      <span className="gauge__figure datum">{figure}</span>
      <span className="gauge__share datum datum--quiet">{note ?? t("journal.gauge.noTotal")}</span>
    </div>
  );
}

export function RunProgress({
  gauges,
  locale,
}: {
  gauges: readonly RunGauge[];
  locale: Locale;
}): React.JSX.Element | null {
  const { t } = useTranslation();

  // Nothing is drawn where nothing is moving. A band headed "reading now" over an empty space
  // says a run is working when it has stopped, which is the one thing this must never say.
  if (gauges.length === 0) {
    return null;
  }

  return (
    <div className="gauges stack stack--tight">
      <span className="label">{t("journal.gauge.head")}</span>
      {gauges.map((gauge) => (
        <Gauge key={gauge.entity} gauge={gauge} locale={locale} />
      ))}
    </div>
  );
}
