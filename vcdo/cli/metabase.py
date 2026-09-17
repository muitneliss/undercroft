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

__all__ = ["provision", "QUESTIONS"]

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
    cards, dashboard = _ensure_dashboard(base_url, session, db_id)
    created["questions"] = cards
    created["dashboard"] = dashboard

    return {
        "database_id": db_id,
        "created": created,
        "tables": tables,
    }


#: The dashboard, defined in version control rather than clicked together.
#:
#: Every question groups by currency. Not decoration -- it is the one thing that
#: makes a mixed-currency total impossible to produce by accident, and a silently
#: summed mixed-currency figure looks entirely plausible.
QUESTIONS = [
    {
        "name": "Won deals by currency",
        "description": "Closed-won deal count and value. Grouped by currency; never summed across.",
        "sql": """
            SELECT currency,
                   count(*)    AS won_deals,
                   sum(amount) AS won_amount
            FROM curated.deals
            WHERE is_won
            GROUP BY currency
            ORDER BY currency
        """,
    },
    {
        "name": "Pipeline by stage",
        "description": (
            "Open and closed deals by stage. Deals with no readable amount show a null value, not zero."
        ),
        "sql": """
            SELECT stage,
                   count(*)                       AS deals,
                   count(amount)                  AS with_amount,
                   count(*) - count(amount)       AS without_amount,
                   sum(amount)                    AS value
            FROM curated.deals
            GROUP BY stage
            ORDER BY deals DESC
        """,
    },
    {
        "name": "Customers by source and kind",
        "description": "Curated customer counts. One row per source record, not per real-world company.",
        "sql": """
            SELECT source, customer_kind, count(*) AS customers
            FROM curated.customers
            GROUP BY source, customer_kind
            ORDER BY source, customer_kind
        """,
    },
    {
        "name": "Data freshness",
        "description": (
            "How old the numbers on this dashboard are. "
            "A figure with no visible age invites acting on a stale one."
        ),
        "sql": "SELECT * FROM curated.freshness ORDER BY table_name",
    },
    {
        "name": "Run health",
        "description": (
            "Recent pipeline stages. unaccounted != 0 means rows vanished without anyone deciding they "
            "should."
        ),
        "sql": """
            SELECT recorded_at, stage, status, rows_in, rows_out, rows_excluded, unaccounted
            FROM ops.run_ledger
            ORDER BY recorded_at DESC
            LIMIT 20
        """,
    },
]

DASHBOARD_NAME = "VietCham overview"


def _ensure_dashboard(base: str, session: str, db_id: int) -> tuple[int, bool]:
    """Create the questions and dashboard if absent. Returns (cards made, dashboard made)."""
    existing_cards = {c["name"]: c for c in _api(base, "/api/card", session=session)}
    made = 0
    card_ids = []

    for q in QUESTIONS:
        if q["name"] in existing_cards:
            card_ids.append(existing_cards[q["name"]]["id"])
            continue
        card = _api(
            base,
            "/api/card",
            {
                "name": q["name"],
                "description": q["description"].strip(),
                "display": "table",
                "visualization_settings": {},
                "dataset_query": {
                    "type": "native",
                    "database": db_id,
                    "native": {"query": q["sql"].strip()},
                },
            },
            session=session,
        )
        card_ids.append(card["id"])
        made += 1

    dashboards = _api(base, "/api/dashboard", session=session)
    dashboards = dashboards["data"] if isinstance(dashboards, dict) else dashboards
    if any(d["name"] == DASHBOARD_NAME for d in dashboards):
        return made, False

    dash = _api(
        base,
        "/api/dashboard",
        {"name": DASHBOARD_NAME, "description": "Curated HubSpot overview, with freshness and run health."},
        session=session,
    )
    _api(
        base,
        f"/api/dashboard/{dash['id']}",
        {
            "dashcards": [
                {
                    "id": -(i + 1),
                    "card_id": cid,
                    "row": (i // 2) * 6,
                    "col": (i % 2) * 9,
                    "size_x": 9,
                    "size_y": 6,
                    "parameter_mappings": [],
                }
                for i, cid in enumerate(card_ids)
            ]
        },
        session=session,
        method="PUT",
    )
    return made, True


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
