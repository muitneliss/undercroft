"""The connection registry against real Postgres.

The decisions are unit-tested without a database; what needs a real one is the
SQL itself -- the upserts, the sealed round trip through `bytea`, and the
`FOR UPDATE` path that stops two refreshes from racing.

The refresher here is a real in-memory implementation of the provider contract,
not a mock. `.claude/rules/tests.md`: a suite that asserts a mock was called is
green whether or not the code works. This one asserts the token that comes back,
and that the rotated refresh token was persisted -- which is the thing that
actually breaks Xero connections when it is wrong.
"""

import base64
import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from vcdo.core.connections import (
    ConnectionError,
    Credential,
    access_token,
    get_connection,
    list_connections,
    read_credential,
    upsert_connection,
    write_credential,
)

pytestmark = pytest.mark.integration

NOW = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)


class RotatingProvider:
    """A provider that invalidates the old refresh token on use, like Xero.

    Real behaviour, in memory: each exchange returns a *new* refresh token and
    refuses the previous one. A registry that forgets to persist the replacement
    passes against a provider with fixed tokens and destroys the connection
    against this one.
    """

    def __init__(self) -> None:
        self.valid = "refresh-0"
        self.exchanges = 0

    def refresh(self, refresh_token: str) -> Credential:
        if refresh_token != self.valid:
            raise AssertionError(f"stale refresh token {refresh_token!r} was replayed")
        self.exchanges += 1
        self.valid = f"refresh-{self.exchanges}"
        return Credential(
            access_token=f"access-{self.exchanges}",
            refresh_token=self.valid,
            expires_at=NOW + timedelta(hours=1),
        )


@pytest.fixture
def key(monkeypatch):
    monkeypatch.setenv("VCDO_SECRET_KEY", base64.b64encode(b"K" * 32).decode())


@pytest.fixture
def conn(key):
    from vcdo.core.config import load

    cfg = load(dict(os.environ))
    try:
        import psycopg

        connection = psycopg.connect(cfg.postgres_dsn, connect_timeout=5)
        connection.execute("SELECT 1 FROM ops.connection LIMIT 1")
    except Exception as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"stack not reachable or migration 007 unapplied: {type(exc).__name__}")
    with connection:
        yield connection
        connection.rollback()


@pytest.fixture
def tenant(conn):
    tenant_id = f"itest-{uuid.uuid4().hex[:8]}"
    conn.execute(
        "INSERT INTO ops.tenant (id, display_name) VALUES (%s, %s)",
        (tenant_id, "CASE-ITEST"),
    )
    return tenant_id


def test_a_connection_round_trips(conn, tenant):
    upsert_connection(
        conn,
        tenant,
        "xero",
        external_account_id="xero-org-uuid",
        external_account_label="CASE-ITEST Pte Ltd",
        scopes=("accounting.transactions.read",),
        config={"entities": ["invoices"]},
    )

    stored = get_connection(conn, tenant, "xero")

    assert stored is not None
    assert stored.external_account_id == "xero-org-uuid"
    assert stored.scopes == ("accounting.transactions.read",)
    assert stored.config == {"entities": ["invoices"]}
    assert stored.is_usable is True


def test_an_absent_connection_is_none_rather_than_an_error(conn, tenant):
    """Absence is a real answer: the control plane renders "not connected"."""
    assert get_connection(conn, tenant, "gmail") is None


def test_connections_are_scoped_to_their_tenant(conn, tenant):
    """The same defect class migration 006 fixed one layer down."""
    other = f"itest-{uuid.uuid4().hex[:8]}"
    conn.execute("INSERT INTO ops.tenant (id, display_name) VALUES (%s, %s)", (other, "CASE-OTHER"))
    upsert_connection(conn, tenant, "xero", external_account_id="ours")
    upsert_connection(conn, other, "xero", external_account_id="theirs")

    mine = list_connections(conn, tenant)

    assert [c.external_account_id for c in mine] == ["ours"]


def test_a_sealed_credential_round_trips_through_the_database(conn, tenant):
    upsert_connection(conn, tenant, "xero")
    write_credential(conn, tenant, "xero", Credential("acc-1", "refresh-0", NOW + timedelta(hours=1)))

    restored = read_credential(conn, tenant, "xero")

    assert restored.access_token == "acc-1"
    assert restored.refresh_token == "refresh-0"


def test_the_stored_ciphertext_does_not_contain_the_token(conn, tenant):
    """A Postgres dump must not be a credential dump."""
    upsert_connection(conn, tenant, "xero")
    write_credential(conn, tenant, "xero", Credential("super-secret-token", "refresh-0"))

    row = conn.execute(
        "SELECT ciphertext FROM app.connection_secret WHERE tenant_id = %s AND source = %s",
        (tenant, "xero"),
    ).fetchone()

    assert b"super-secret-token" not in bytes(row[0])


def test_a_fresh_token_is_returned_without_contacting_the_provider(conn, tenant):
    provider = RotatingProvider()
    upsert_connection(conn, tenant, "xero")
    write_credential(conn, tenant, "xero", Credential("acc-1", "refresh-0", NOW + timedelta(hours=2)))

    token = access_token(conn, tenant, "xero", refresher=provider.refresh, now=NOW)

    assert token == "acc-1"
    assert provider.exchanges == 0


def test_an_expiring_token_is_refreshed_and_the_rotation_is_persisted(conn, tenant):
    """Xero kills the old refresh token on use. Losing the replacement costs the
    connection, and the customer has to consent again."""
    provider = RotatingProvider()
    upsert_connection(conn, tenant, "xero")
    write_credential(conn, tenant, "xero", Credential("acc-0", "refresh-0", NOW - timedelta(minutes=1)))

    token = access_token(conn, tenant, "xero", refresher=provider.refresh, now=NOW)

    assert token == "access-1"
    assert read_credential(conn, tenant, "xero").refresh_token == "refresh-1"
    # The replayed-token guard in RotatingProvider would fire if we had not.
    assert access_token(conn, tenant, "xero", refresher=provider.refresh, now=NOW + timedelta(hours=3))


def test_an_expired_token_with_no_way_to_refresh_asks_for_reconsent(conn, tenant):
    """Returning the stale token would surface as a 401 deep inside a sync, which
    reads as "the source is down" rather than "reconnect this"."""
    upsert_connection(conn, tenant, "hubspot")
    write_credential(conn, tenant, "hubspot", Credential("acc-0", "", NOW - timedelta(minutes=1)))

    with pytest.raises(ConnectionError, match="re-consent"):
        access_token(conn, tenant, "hubspot", now=NOW)

    assert get_connection(conn, tenant, "hubspot").status == "needs_reconnect"


def test_asking_for_a_credential_that_was_never_stored_is_an_error(conn, tenant):
    upsert_connection(conn, tenant, "drive")

    with pytest.raises(ConnectionError, match="has not completed its OAuth flow"):
        read_credential(conn, tenant, "drive")
