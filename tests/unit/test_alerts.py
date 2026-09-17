"""Alerts must fire on real problems and stay quiet otherwise.

Both directions carry equal weight here. An alert that fires on a healthy day
gets muted, and a muted alert is worse than no alert — it looks like coverage.
"""

from datetime import UTC, datetime, timedelta

from vcdo.core.alerts import MIN_RUNS_FOR_CADENCE, evaluate

NOW = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)


def row(stage="land:hubspot", *, status="ok", rows_out=100, unaccounted=0, ago_hours=0, **extra):
    return {
        "stage": stage,
        "status": status,
        "rows_in": rows_out + unaccounted,
        "rows_out": rows_out,
        "unaccounted": unaccounted,
        "recorded_at": NOW - timedelta(hours=ago_hours),
        **extra,
    }


# -- binary signals ----------------------------------------------------------


def test_a_failed_stage_is_critical():
    alerts = evaluate([row(status="error", error_type="SourceError")], now=NOW)

    assert [a.code for a in alerts] == ["stage_error"]
    assert alerts[0].severity == "critical"


def test_rows_vanishing_without_a_reason_is_critical():
    """The signature of a silent shortfall, not a smaller month."""
    alerts = evaluate([row(unaccounted=12)], now=NOW)

    assert any(a.code == "rows_unaccounted" and a.severity == "critical" for a in alerts)


def test_a_deliberate_exclusion_raises_nothing():
    """Rows dropped ON PURPOSE must not alert, or the alert gets muted."""
    alerts = evaluate([row(rows_out=88, unaccounted=0, rows_excluded=12)], now=NOW)

    assert alerts == []


def test_a_healthy_run_is_silent():
    alerts = evaluate([row(), row(ago_hours=24), row(ago_hours=48)], now=NOW)

    assert alerts == []


# -- row drops ---------------------------------------------------------------


def test_a_halving_of_row_count_warns():
    alerts = evaluate([row(rows_out=100, ago_hours=24), row(rows_out=40)], now=NOW)

    assert any(a.code == "row_count_drop" for a in alerts)


def test_ordinary_variation_does_not_warn():
    """A threshold that fires on normal movement is a threshold nobody keeps."""
    alerts = evaluate([row(rows_out=100, ago_hours=24), row(rows_out=85)], now=NOW)

    assert [a for a in alerts if a.code == "row_count_drop"] == []


def test_growth_never_warns():
    alerts = evaluate([row(rows_out=100, ago_hours=24), row(rows_out=400)], now=NOW)

    assert [a for a in alerts if a.code == "row_count_drop"] == []


def test_a_first_ever_run_cannot_be_a_drop():
    """There is nothing to compare against."""
    alerts = evaluate([row(rows_out=5)], now=NOW)

    assert [a for a in alerts if a.code == "row_count_drop"] == []


def test_the_threshold_is_declared_as_untuned():
    """A number presented as considered gets treated as considered, and nobody
    revisits it."""
    alerts = evaluate([row(rows_out=100, ago_hours=24), row(rows_out=10)], now=NOW)
    drop = next(a for a in alerts if a.code == "row_count_drop")

    assert "untuned" in drop.detail


# -- silence -----------------------------------------------------------------


def test_a_source_that_has_stopped_is_critical():
    """Daily cadence learned from history; last run four days ago."""
    history = [row(ago_hours=h) for h in (96 + 72, 96 + 48, 96 + 24, 96)]
    alerts = evaluate(history, now=NOW)

    assert any(a.code == "source_silent" and a.severity == "critical" for a in alerts)


def test_a_source_running_on_its_usual_cadence_is_silent():
    history = [row(ago_hours=h) for h in (72, 48, 24, 1)]
    alerts = evaluate(history, now=NOW)

    assert [a for a in alerts if a.code == "source_silent"] == []


def test_one_missed_run_is_tolerated():
    """Three times the median absorbs a miss plus jitter; firing on a single
    skipped run would make the alert noise."""
    history = [row(ago_hours=h) for h in (96, 72, 48)]
    alerts = evaluate(history, now=NOW)

    assert [a for a in alerts if a.code == "source_silent"] == []


def test_a_brand_new_source_never_reports_as_silent():
    """Below three runs there is no median worth having, and an alert that fires
    on day one is muted by day two."""
    history = [row(ago_hours=h) for h in (500, 400)]

    assert len(history) < MIN_RUNS_FOR_CADENCE
    assert [a for a in evaluate(history, now=NOW) if a.code == "source_silent"] == []


def test_cadence_is_learned_per_stage_not_shared():
    """An hourly stage and a daily stage must not hold each other to one clock."""
    hourly = [row("land:fast", ago_hours=h) for h in (3, 2, 1)]
    daily = [row("land:slow", ago_hours=h) for h in (72, 48, 24)]

    alerts = evaluate(hourly + daily, now=NOW)

    assert [a for a in alerts if a.code == "source_silent"] == []
