"""The connection registry's decisions, without a database.

The SQL is exercised against real Postgres in
tests/integration/test_connection_registry.py. What is here is the part worth
reasoning about: when a credential is too stale to start a run with, and what the
registry refuses to accept at all.
"""

from datetime import UTC, datetime, timedelta

import pytest

from vcdo.core.connections import (
    REFRESH_SKEW,
    Connection,
    ConnectionError,
    Credential,
    needs_refresh,
    upsert_connection,
)

NOW = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)


# -- the refresh decision: it fires, and it stays quiet -----------------------


def test_a_token_expiring_soon_is_refreshed_before_the_run_starts():
    """Xero access tokens last 30 minutes and a sync takes minutes; "still valid
    right now" is not valid enough."""
    nearly = Credential("tok", "refresh", NOW + REFRESH_SKEW - timedelta(seconds=1))

    assert needs_refresh(nearly, now=NOW) is True


def test_a_token_with_plenty_of_life_is_left_alone():
    fresh = Credential("tok", "refresh", NOW + timedelta(hours=2))

    assert needs_refresh(fresh, now=NOW) is False


def test_an_already_expired_token_is_refreshed():
    expired = Credential("tok", "refresh", NOW - timedelta(minutes=1))

    assert needs_refresh(expired, now=NOW) is True


def test_a_token_with_no_expiry_is_never_refreshed():
    """A HubSpot private-app token genuinely does not expire. Inventing an expiry
    would refresh something with no refresh token, turning a working connection
    into one that needs re-consent."""
    forever = Credential("tok", refresh_token="")

    assert needs_refresh(forever, now=NOW) is False


# -- the sealed bundle round-trips -------------------------------------------


def test_a_credential_survives_the_json_round_trip():
    original = Credential("acc", "ref", NOW + timedelta(hours=1))

    assert Credential.from_json(original.as_json()) == original


def test_a_credential_without_an_expiry_round_trips_as_none_not_now():
    """`None` means "no expiry recorded". A datetime substituted here would be a
    guess, and would expire a token that does not expire."""
    restored = Credential.from_json(Credential("acc").as_json())

    assert restored.expires_at is None
    assert restored.refresh_token == ""


# -- what the registry refuses ------------------------------------------------


def test_an_unknown_source_is_refused_before_any_sql_runs():
    with pytest.raises(ConnectionError, match="unknown source"):
        upsert_connection(None, "CASE-001", "salesforce")


def test_a_known_source_with_an_unknown_status_is_refused():
    with pytest.raises(ConnectionError, match="unknown status"):
        upsert_connection(None, "CASE-001", "xero", status="probably-fine")


# -- usability is narrower than "not disconnected" -----------------------------


def test_a_connected_connection_is_usable():
    assert Connection("CASE-001", "xero", "connected").is_usable is True


def test_a_connection_still_awaiting_its_scope_is_not_usable():
    """A Drive connection with no folders chosen would otherwise run, copy
    nothing, and report success."""
    assert Connection("CASE-001", "drive", "needs_scope").is_usable is False


def test_a_connection_needing_reconsent_is_not_usable():
    assert Connection("CASE-001", "gmail", "needs_reconnect").is_usable is False
