"""Alerting over the run ledger.

Two classes of signal, and conflating them is how alerting dies:

**Binary signals need no threshold.** A stage errored. Rows vanished with no
exclusion reason. A source that was reporting has gone silent. Each is either
true or it is not, so each is ``critical`` immediately — there is nothing to
tune and no judgement call to get wrong.

**Continuous signals need a threshold, and every threshold here is an untuned
starting point with a stated reason.** Labelling them that way matters: a number
presented as considered gets treated as considered, and nobody revisits it. These
are guesses, written down as guesses, to be retuned against real data.

**Expected cadence is learned, never configured.** The median gap between runs is
what the pipeline actually does; a hand-configured schedule is what someone
*intended*, and the two drift apart silently. Below three observed runs there is
no median worth having, so the silence check stays quiet rather than firing on a
new source — a check that fires on day one gets muted on day two.
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

__all__ = ["Alert", "evaluate", "MIN_RUNS_FOR_CADENCE", "ROW_DROP_FRACTION", "SILENCE_MULTIPLIER"]

#: Below this many observed runs there is no meaningful median gap, so the
#: silence check abstains. A new source has no history, and an alert that fires
#: on a source's first day is an alert that gets muted on its second.
MIN_RUNS_FOR_CADENCE = 3

#: UNTUNED STARTING POINT. A run producing less than this fraction of the
#: previous run's rows is treated as a suspicious drop.
#:
#: Reason for 0.5: a halving is well outside normal business variation for these
#: sources but comfortably inside what a broken filter or a partial auth failure
#: produces. Expect false positives around genuine seasonal lulls; retune against
#: real data rather than raising it to silence one.
ROW_DROP_FRACTION = 0.5

#: UNTUNED STARTING POINT. A source is "silent" once this many times its own
#: median gap has passed.
#:
#: Reason for 3: tolerates one missed run plus scheduling jitter without firing,
#: while still catching a source that has genuinely stopped within a day on a
#: daily cadence.
SILENCE_MULTIPLIER = 3.0


@dataclass(frozen=True, slots=True)
class Alert:
    severity: str  # "critical" | "warning"
    code: str
    subject: str
    detail: str

    def __str__(self) -> str:
        return f"[{self.severity}] {self.code} ({self.subject}): {self.detail}"


def evaluate(ledger_rows: Sequence[dict], *, now: datetime | None = None) -> list[Alert]:
    """Evaluate alerts over run-ledger rows, newest last.

    Pure: takes rows and a clock, returns alerts. No querying, no sending. That
    is what makes the thresholds testable against constructed histories rather
    than only observable in production.
    """
    alerts: list[Alert] = []
    alerts += _binary(ledger_rows)
    alerts += _row_drops(ledger_rows)
    alerts += _silence(ledger_rows, now=now)
    return alerts


def _binary(rows: Sequence[dict]) -> list[Alert]:
    """Signals that are true or false. No thresholds, always critical."""
    out = []
    for row in rows:
        stage = row.get("stage", "<unknown>")

        if row.get("status") == "error":
            out.append(
                Alert(
                    "critical",
                    "stage_error",
                    stage,
                    f"stage failed with {row.get('error_type') or 'an error'}; "
                    "the previous generation is still serving",
                )
            )

        if row.get("unaccounted", 0):
            out.append(
                Alert(
                    "critical",
                    "rows_unaccounted",
                    stage,
                    f"{row['unaccounted']} rows vanished with no exclusion reason. "
                    "This is the signature of a silent shortfall, not a smaller month.",
                )
            )
    return out


def _row_drops(rows: Sequence[dict]) -> list[Alert]:
    """A run producing far fewer rows than the one before it."""
    out = []
    by_stage: dict[str, list[dict]] = {}
    for row in rows:
        by_stage.setdefault(row.get("stage", ""), []).append(row)

    for stage, history in by_stage.items():
        ok = [r for r in history if r.get("status") == "ok"]
        if len(ok) < 2:
            continue
        previous, latest = ok[-2], ok[-1]
        before, after = previous.get("rows_out", 0), latest.get("rows_out", 0)
        if before <= 0:
            continue
        if after < before * ROW_DROP_FRACTION:
            out.append(
                Alert(
                    "warning",
                    "row_count_drop",
                    stage,
                    f"rows_out fell from {before} to {after} "
                    f"(threshold: below {ROW_DROP_FRACTION:.0%} of the previous run, untuned)",
                )
            )
    return out


def _silence(rows: Sequence[dict], *, now: datetime | None) -> list[Alert]:
    """A source that was reporting and has stopped.

    Cadence is learned from the ledger's own inter-run gaps. A configured
    schedule would describe what someone intended; the median describes what the
    pipeline does, and only the second one detects a change.
    """
    if now is None:
        now = datetime.now(tz=_tz_of(rows))

    out = []
    by_stage: dict[str, list[datetime]] = {}
    for row in rows:
        at = _parse(row.get("recorded_at"))
        if at:
            by_stage.setdefault(row.get("stage", ""), []).append(at)

    for stage, times in by_stage.items():
        times = sorted(times)
        if len(times) < MIN_RUNS_FOR_CADENCE:
            continue  # no median worth having

        gaps = [(b - a).total_seconds() for a, b in zip(times, times[1:], strict=False)]
        median_gap = statistics.median(gaps)
        if median_gap <= 0:
            continue

        since = (now - times[-1]).total_seconds()
        if since > median_gap * SILENCE_MULTIPLIER:
            out.append(
                Alert(
                    "critical",
                    "source_silent",
                    stage,
                    f"last ran {timedelta(seconds=int(since))} ago; its own median gap is "
                    f"{timedelta(seconds=int(median_gap))} "
                    f"(threshold: {SILENCE_MULTIPLIER}x median, untuned)",
                )
            )
    return out


def _parse(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _tz_of(rows: Sequence[dict]):
    for row in rows:
        at = _parse(row.get("recorded_at"))
        if at and at.tzinfo:
            return at.tzinfo
    from datetime import UTC

    return UTC
