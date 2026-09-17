"""Request dependencies: the database, the signed-in user, and tenant access.

**A non-member gets 404, not 403.** 403 confirms the tenant exists, which turns
this endpoint into an oracle for enumerating our customer list -- and a customer
list is exactly the PII the rest of the platform goes to lengths to keep out of
keys and logs. "You cannot see it" and "it is not there" look identical from
outside on purpose.

Staff see every tenant. Everyone else sees the tenants they are a member of, and
membership carries a role, because a viewer must not be able to press the button
that mints an OAuth token.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated, Any

from fastapi import Cookie, Depends, HTTPException

from vcdo.api.security import SESSION_COOKIE, user_for_session
from vcdo.api.settings import ApiSettings, load_api_settings

__all__ = ["Db", "CurrentUser", "settings_dep", "require_member", "require_role", "ROLE_RANK"]

#: Roles in increasing authority. A viewer reads; a member runs syncs; an admin
#: connects and disconnects accounts and manages who else has access.
ROLE_RANK = {"viewer": 0, "member": 1, "admin": 2}


def get_db() -> Iterator[Any]:
    """One transaction per request, committed only on success.

    A rollback on the error path matters more here than in the pipeline: a
    half-written connection row -- status connected, no credential stored -- is a
    connection the UI shows as working and every run then fails on.
    """
    import psycopg

    from vcdo.core.config import load

    conn = psycopg.connect(load().postgres_dsn, connect_timeout=10)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


Db = Annotated[Any, Depends(get_db)]


def settings_dep() -> ApiSettings:
    return load_api_settings()


Settings = Annotated[ApiSettings, Depends(settings_dep)]


def current_user(
    conn: Db,
    session_id: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> dict:
    user = user_for_session(conn, session_id or "")
    if user is None:
        raise HTTPException(status_code=401, detail="not signed in")
    return user


CurrentUser = Annotated[dict, Depends(current_user)]


def _membership(conn: Any, user: dict, tenant_id: str) -> str | None:
    """The user's role on a tenant, or ``None`` if they have no access to it."""
    if user["is_staff"]:
        exists = conn.execute("SELECT 1 FROM ops.tenant WHERE id = %s", (tenant_id,)).fetchone()
        return "admin" if exists else None
    row = conn.execute(
        "SELECT role FROM app.tenant_member WHERE tenant_id = %s AND user_id = %s",
        (tenant_id, user["id"]),
    ).fetchone()
    return row[0] if row else None


def require_member(tenant_id: str, conn: Db, user: CurrentUser) -> str:
    """Resolve the caller's role on ``tenant_id``, or 404.

    Deliberately not 403. See the module docstring.
    """
    role = _membership(conn, user, tenant_id)
    if role is None:
        raise HTTPException(status_code=404, detail="no such tenant")
    return role


Member = Annotated[str, Depends(require_member)]


def require_role(minimum: str):
    """Dependency factory: the caller must hold at least ``minimum`` on the tenant.

    Returns the caller's actual role so a handler can branch further without
    querying membership a second time.
    """

    def check(role: Member) -> str:
        if ROLE_RANK[role] < ROLE_RANK[minimum]:
            raise HTTPException(status_code=403, detail=f"requires {minimum}")
        return role

    return check
