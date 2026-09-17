"""The BI role must not be able to read credentials, users or sessions.

REGRESSION RISK THIS PINS: migration 002 ends with

    ALTER DEFAULT PRIVILEGES IN SCHEMA ops GRANT SELECT ON TABLES TO metabase_ro;

so *every table created in `ops` from then on* is automatically readable by the
Metabase role. Had the control plane's sealed tokens been added to `ops` -- the
obvious place, next to the connection they belong to -- every dashboard user
would have gained read access to every customer's OAuth credentials, silently,
the moment the migration ran. Nobody would have had to grant anything.

So the tables live in `app`, which has no such default and is revoked outright,
the way `dq` already is. This test is the thing that notices if a later migration
moves one of them back, or adds an ALTER DEFAULT PRIVILEGES to `app`.

The positive half matters too: `ops.connection` and `ops.tenant` are *meant* to
stay readable, because run health and tenant labels belong on a dashboard. A
blanket lockout would pass a "secrets are safe" test while breaking BI.
"""

import os

import pytest

pytestmark = pytest.mark.integration

#: Readable by Metabase on purpose: operational state, no secret material.
OPEN_TO_BI = ("ops.tenant", "ops.connection", "ops.audit_log")

#: Never readable by Metabase: credentials and identity.
CLOSED_TO_BI = (
    "app.connection_secret",
    "app.app_user",
    "app.tenant_member",
    "app.invitation",
    "app.session",
)


@pytest.fixture
def conn():
    from vcdo.core.config import load

    cfg = load(dict(os.environ))
    try:
        import psycopg

        connection = psycopg.connect(cfg.postgres_dsn, connect_timeout=5)
        connection.execute("SELECT 1 FROM ops.tenant LIMIT 1")
    except Exception as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"stack not reachable or migration 007 unapplied: {type(exc).__name__}")
    with connection:
        yield connection


def test_the_bi_role_cannot_reach_the_app_schema_at_all(conn):
    """Revoking USAGE on the schema is the control; table grants are belt and braces."""
    granted = conn.execute("SELECT has_schema_privilege('metabase_ro', 'app', 'USAGE')").fetchone()

    assert granted is not None
    assert granted[0] is False


def test_the_bi_role_cannot_read_any_credential_or_identity_table(conn):
    readable = [
        table
        for table in CLOSED_TO_BI
        if conn.execute("SELECT has_table_privilege('metabase_ro', %s, 'SELECT')", (table,)).fetchone()[0]
    ]

    assert readable == [], f"BI role can read {readable}"


def test_the_bi_role_can_still_read_operational_state(conn):
    """The guard must not fire on the tables dashboards legitimately need."""
    unreadable = [
        table
        for table in OPEN_TO_BI
        if not conn.execute("SELECT has_table_privilege('metabase_ro', %s, 'SELECT')", (table,)).fetchone()[0]
    ]

    assert unreadable == [], f"BI role has lost {unreadable}"


def test_the_app_schema_has_no_default_grant_to_the_bi_role(conn):
    """The `ops` default-privilege grant is exactly how this would regress.

    A future migration adding one to `app` would reopen every table added after
    it, without touching any of the tables above.
    """
    row = conn.execute(
        """
        SELECT count(*)
        FROM pg_default_acl d
        JOIN pg_namespace n ON n.oid = d.defaclnamespace
        WHERE n.nspname = 'app'
          AND array_to_string(d.defaclacl, ',') LIKE '%metabase_ro%'
        """
    ).fetchone()

    assert row is not None
    assert row[0] == 0
