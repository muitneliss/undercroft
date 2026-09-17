"""Who can see which tenant, against a real database.

THE DEFECT THIS PINS: one customer reading another's data. It is the same class
migration 006 fixed one layer down, where an aggregate crossed tenants and
reported one customer's deals as another's.

A non-member gets **404, not 403**. 403 confirms the tenant exists, which turns
this endpoint into a way to enumerate our customer list -- and the customer list
is exactly the PII the rest of the platform keeps out of keys and logs. Both
tests are here: the member sees it, the stranger cannot tell it is there.
"""

import base64
import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest

pytestmark = pytest.mark.integration

#: Marks rows these tests create, so teardown can find them without guessing.
ITEST_PREFIX = "itest-"
ITEST_TENANT_NAME = "CASE-ITEST Ltd"


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("VCDO_SECRET_KEY", base64.b64encode(b"K" * 32).decode())
    monkeypatch.setenv("VCDO_API_BASE_URL", "https://vcdo.example")
    monkeypatch.setenv("VCDO_SESSION_SECRET", "itest-secret")
    monkeypatch.setenv("VCDO_TRIGGER_TOKEN", "itest-trigger")
    monkeypatch.setenv("VCDO_SSO_STAFF_DOMAINS", "vietcham.example")
    monkeypatch.setenv("VCDO_UI_DIST", "/nonexistent-so-the-spa-404s")


@pytest.fixture
def conn(env):
    """A connection that cleans up after itself.

    `autocommit` is needed because the API opens its own connection per request
    and must see the rows these tests insert -- a transaction would hide them.
    That means nothing rolls back at the end, so the teardown is explicit.

    Without it each run left ~80 tenants and users behind in the development
    database. `test_pdf_acceptance.py` states the reason this matters: a test
    suite that grows the dev environment without bound eventually gets switched
    off.
    """
    from vcdo.core.config import load

    cfg = load(dict(os.environ))
    try:
        import psycopg

        connection = psycopg.connect(cfg.postgres_dsn, connect_timeout=5, autocommit=True)
        connection.execute("SELECT 1 FROM app.app_user LIMIT 1")
    except Exception as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"stack not reachable or migration 007 unapplied: {type(exc).__name__}")

    with connection:
        yield connection

        # Sessions, members and connections all cascade from these two.
        connection.execute("DELETE FROM app.app_user WHERE email LIKE %s", (f"{ITEST_PREFIX}%",))
        connection.execute("DELETE FROM ops.tenant WHERE display_name = %s", (ITEST_TENANT_NAME,))


@pytest.fixture
def client(env):
    from fastapi.testclient import TestClient

    from vcdo.api.app import create_app

    return TestClient(create_app(), raise_server_exceptions=False)


def make_user(conn, *, is_staff=False):
    email = f"{ITEST_PREFIX}{uuid.uuid4().hex[:8]}@example.test"
    row = conn.execute(
        "INSERT INTO app.app_user (email, display_name, is_staff) VALUES (%s,%s,%s) RETURNING id",
        (email, "CASE-ITEST user", is_staff),
    ).fetchone()
    user_id = str(row[0])
    session = conn.execute(
        "INSERT INTO app.session (user_id, expires_at) VALUES (%s,%s) RETURNING id",
        (user_id, datetime.now(UTC) + timedelta(days=1)),
    ).fetchone()
    return user_id, str(session[0])


def make_tenant(conn):
    tenant_id = f"CASE-{uuid.uuid4().hex[:6].upper()}"
    conn.execute("INSERT INTO ops.tenant (id, display_name) VALUES (%s,%s)", (tenant_id, ITEST_TENANT_NAME))
    return tenant_id


def as_user(client, session_id):
    client.cookies.set("vcdo_session", session_id)
    return client


# -- the boundary -------------------------------------------------------------


def test_a_member_can_read_their_own_tenant(conn, client):
    tenant = make_tenant(conn)
    user_id, session = make_user(conn)
    conn.execute(
        "INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES (%s,%s,'admin')",
        (tenant, user_id),
    )

    response = as_user(client, session).get(f"/api/tenants/{tenant}")

    assert response.status_code == 200
    assert response.json()["id"] == tenant


def test_a_stranger_cannot_tell_that_another_tenant_exists(conn, client):
    """404, never 403: a 403 confirms the tenant is real."""
    tenant = make_tenant(conn)
    _, session = make_user(conn)

    response = as_user(client, session).get(f"/api/tenants/{tenant}")

    assert response.status_code == 404


def test_a_stranger_gets_the_same_answer_for_a_tenant_that_does_not_exist(conn, client):
    """The two cases must be indistinguishable, or the difference is the oracle."""
    _, session = make_user(conn)

    real = make_tenant(conn)
    invented = "CASE-ZZZZZZ"

    client = as_user(client, session)
    assert client.get(f"/api/tenants/{real}").status_code == 404
    assert client.get(f"/api/tenants/{invented}").status_code == 404


def test_listing_tenants_shows_only_ones_the_user_belongs_to(conn, client):
    mine = make_tenant(conn)
    theirs = make_tenant(conn)
    user_id, session = make_user(conn)
    conn.execute(
        "INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES (%s,%s,'viewer')",
        (mine, user_id),
    )

    listed = {t["id"] for t in as_user(client, session).get("/api/tenants").json()}

    assert mine in listed
    assert theirs not in listed


def test_staff_see_every_tenant(conn, client):
    tenant = make_tenant(conn)
    _, session = make_user(conn, is_staff=True)

    listed = {t["id"] for t in as_user(client, session).get("/api/tenants").json()}

    assert tenant in listed


# -- roles --------------------------------------------------------------------


def test_a_viewer_cannot_disconnect_an_account(conn, client):
    """Roles exist so that read access does not carry the button that revokes a
    customer's accounting connection."""
    tenant = make_tenant(conn)
    user_id, session = make_user(conn)
    conn.execute(
        "INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES (%s,%s,'viewer')",
        (tenant, user_id),
    )

    response = as_user(client, session).delete(f"/api/tenants/{tenant}/connections/xero")

    assert response.status_code == 403


def test_an_admin_can_disconnect_an_account(conn, client):
    tenant = make_tenant(conn)
    user_id, session = make_user(conn)
    conn.execute(
        "INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES (%s,%s,'admin')",
        (tenant, user_id),
    )
    conn.execute(
        "INSERT INTO ops.connection (tenant_id, source, status) VALUES (%s,'xero','connected')",
        (tenant,),
    )

    response = as_user(client, session).delete(f"/api/tenants/{tenant}/connections/xero")

    assert response.status_code == 204


# -- sessions -----------------------------------------------------------------


def test_no_cookie_is_401_not_a_redirect(conn, client):
    """The SPA decides where to send the user; the API states the fact."""
    assert client.get("/api/auth/session").status_code == 401


def test_a_revoked_session_stops_working_immediately(conn, client):
    """Signing out has to mean now, not at expiry -- these buttons mint tokens."""
    _, session = make_user(conn)
    signed_in = as_user(client, session)
    assert signed_in.get("/api/auth/session").status_code == 200

    conn.execute("UPDATE app.session SET revoked_at = now() WHERE id = %s", (session,))

    assert signed_in.get("/api/auth/session").status_code == 401


# -- the connection checklist -------------------------------------------------


def test_every_source_is_listed_even_before_anything_is_connected(conn, client):
    """The onboarding checklist needs all four from the first visit; an empty
    list would render as "nothing to do"."""
    tenant = make_tenant(conn)
    user_id, session = make_user(conn)
    conn.execute(
        "INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES (%s,%s,'admin')",
        (tenant, user_id),
    )

    body = as_user(client, session).get(f"/api/tenants/{tenant}/connections").json()

    assert [c["source"] for c in body] == ["hubspot", "xero", "gmail", "drive"]
    assert {c["status"] for c in body} == {"disconnected"}
