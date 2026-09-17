"""Provision Metabase reproducibly.

Clicking through a UI once is not a deployment. If the Metabase application
database is ever restored, rebuilt, or stood up in a second environment, the
connection has to come back the same way -- and "ask someone what they typed"
is not a recovery procedure.

Idempotent: running it against an already-provisioned instance is a no-op that
reports what it found.

The BI connection deliberately uses the ``metabase_ro`` role (migration 002).
Metabase cannot write to curated tables and cannot read ``dq.quarantine``, whose
rows carry raw source payloads.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

__all__ = ["provision"]

DB_NAME = "VietCham curated"


class MetabaseError(Exception):
    pass


def _api(
    base: str,
    path: str,
    body: dict | None = None,
    session: str | None = None,
    method: str | None = None,
):
    headers = {"Content-Type": "application/json"}
    if session:
        headers["X-Metabase-Session"] = session
    req = urllib.request.Request(
        f"{base}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
        method=method or ("POST" if body is not None else "GET"),
    )
    try:
        return json.loads(urllib.request.urlopen(req, timeout=120).read() or b"{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:400]
        raise MetabaseError(f"{method or 'GET'} {path} -> HTTP {exc.code}: {detail}") from exc


def provision(
    base_url: str,
    *,
    admin_email: str,
    admin_password: str,
    bi_password: str,
    pg_host: str,
) -> dict:
    """Ensure Metabase has an admin and a read-only connection to curated.

    Returns a summary of what was created versus already present.
    """
    created = {"admin": False, "database": False}

    props = _api(base_url, "/api/session/properties")
    if not props.get("has-user-setup"):
        token = props.get("setup-token")
        if not token:
            raise MetabaseError("Metabase reports no user setup but exposes no setup token")
        _api(
            base_url,
            "/api/setup",
            {
                "token": token,
                "user": {
                    "first_name": "VCDO",
                    "last_name": "Admin",
                    "email": admin_email,
                    "password": admin_password,
                    "site_name": "VietCham Data Platform",
                },
                "prefs": {
                    "site_name": "VietCham Data Platform",
                    "site_locale": "en",
                    # Off by default. This instance will hold customer analytics;
                    # usage telemetry is not something to opt into silently.
                    "allow_tracking": False,
                },
            },
        )
        created["admin"] = True

    session = _api(base_url, "/api/session", {"username": admin_email, "password": admin_password})["id"]

    databases = _api(base_url, "/api/database", session=session)
    databases = databases["data"] if isinstance(databases, dict) else databases
    existing = next((d for d in databases if d["name"] == DB_NAME), None)

    if existing is None:
        existing = _api(
            base_url,
            "/api/database",
            {
                "engine": "postgres",
                "name": DB_NAME,
                "details": {
                    "host": pg_host,
                    "port": 5432,
                    "dbname": "vcdo",
                    "user": "metabase_ro",
                    "password": bi_password,
                    "ssl": False,
                    "tunnel-enabled": False,
                },
                "is_full_sync": True,
            },
            session=session,
        )
        created["database"] = True

    db_id = existing["id"]
    tables = _wait_for_tables(base_url, session, db_id)

    return {
        "database_id": db_id,
        "created": created,
        "tables": tables,
    }


def _wait_for_tables(base: str, session: str, db_id: int, attempts: int = 40) -> list[str]:
    """Wait for the schema scan. An empty table list is not proof of no access."""
    names: list[str] = []
    for _ in range(attempts):
        detail = _api(base, f"/api/database/{db_id}?include=tables", session=session)
        names = sorted(f"{t['schema']}.{t['name']}" for t in detail.get("tables", []))
        if "curated.deals" in names:
            return names
        time.sleep(3)
    raise MetabaseError(
        f"curated.deals never became visible to Metabase (saw: {names or 'nothing'}). "
        "Check the metabase_ro grants in migration 002."
    )


def provision_from_env() -> dict:
    return provision(
        os.environ.get("VCDO_METABASE_URL", "http://localhost:13000"),
        admin_email=os.environ.get("VCDO_METABASE_ADMIN_EMAIL", "admin@vietcham.local"),
        admin_password=os.environ["VCDO_METABASE_ADMIN_PASSWORD"],
        bi_password=os.environ["VCDO_METABASE_RO_PASSWORD"],
        pg_host=os.environ.get("VCDO_METABASE_PG_HOST", "postgres"),
    )
