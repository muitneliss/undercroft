"""Reading and configuring a tenant's connections.

Connecting is in :mod:`vcdo.api.routers.oauth`; this is everything around it --
what is connected, what it is scoped to, and disconnecting.

**Scope selection is a separate step from consent, and cannot be merged into
it.** You cannot list a customer's Drive folders or Gmail labels until you hold
a token for their account, so the UI's "choose what to sync" panel necessarily
comes after the redirect returns. That ordering is enforced by reality, not by
the interface: a connection whose scope has not been chosen is left in
``needs_scope``, which :meth:`Connection.is_usable` treats as not runnable so a
sync cannot start and copy nothing while reporting success.
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from vcdo.api.deps import CurrentUser, Db, require_member, require_role
from vcdo.api.models import ConnectionOut
from vcdo.core.connections import SOURCES, get_connection, list_connections, set_status

router = APIRouter(prefix="/api/tenants/{tenant_id}/connections", tags=["connections"])

Admin = Annotated[str, Depends(require_role("admin"))]


class ConfigIn(BaseModel):
    """What the operator chose to sync. Shape differs per source, hence jsonb.

    ``folder_ids`` for Drive, ``labels`` for Gmail, ``entities`` for HubSpot and
    Xero. Validated where it matters: a Drive folder id is interpolated into
    Drive's ``q`` query, and :class:`vcdo.sources.drive.DriveSource` checks its
    shape again on the way out.
    """

    folder_ids: list[str] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)
    entities: list[str] = Field(default_factory=list)
    schedule_cron: str = ""


def _expiries(conn: Any, tenant_id: str) -> dict[str, Any]:
    """Credential expiry per source, read in the clear beside the ciphertext.

    This is why ``app.connection_secret.expires_at`` is not sealed: answering
    "which connections need attention" must not require decrypting every row.
    """
    rows = conn.execute(
        "SELECT source, expires_at FROM app.connection_secret WHERE tenant_id = %s",
        (tenant_id,),
    ).fetchall()
    return {r[0]: r[1] for r in rows}


@router.get("")
def list_for_tenant(tenant_id: str, conn: Db, user: CurrentUser) -> list[ConnectionOut]:
    """Every source, connected or not.

    Sources with no row are returned as ``disconnected`` rather than omitted. The
    onboarding checklist needs to show all four from the first visit, and an
    empty list would render as "nothing to do".
    """
    require_member(tenant_id, conn, user)

    existing = {c.source: c for c in list_connections(conn, tenant_id)}
    expiries = _expiries(conn, tenant_id)

    out = []
    for source in SOURCES:
        found = existing.get(source)
        if found is None:
            out.append(ConnectionOut(source=source, status="disconnected"))
            continue
        out.append(
            ConnectionOut(
                source=source,
                status=found.status,
                external_account_id=found.external_account_id,
                external_account_label=found.external_account_label,
                scopes=list(found.scopes),
                config=found.config,
                schedule_cron=found.schedule_cron,
                last_run_id=found.last_run_id,
                expires_at=expiries.get(source),
            )
        )
    return out


@router.put("/{source}/config")
def set_config(
    tenant_id: str,
    source: str,
    body: ConfigIn,
    conn: Db,
    user: CurrentUser,
    role: Admin,
) -> ConnectionOut:
    """Record what to sync, and promote the connection out of ``needs_scope``."""
    if source not in SOURCES:
        raise HTTPException(status_code=404, detail="unknown source")

    connection = get_connection(conn, tenant_id, source)
    if connection is None:
        raise HTTPException(status_code=409, detail="connect the account before choosing its scope")

    config = {
        "folder_ids": body.folder_ids,
        "labels": body.labels,
        "entities": body.entities,
    }

    if source == "drive" and not body.folder_ids:
        # The connection stays unusable rather than running unscoped. An
        # unscoped Drive listing copies everything the credential can reach into
        # a create-only lake, which cannot be undone.
        raise HTTPException(status_code=400, detail="choose at least one Drive folder")

    conn.execute(
        """
        UPDATE ops.connection
        SET config = %s, schedule_cron = %s, status = 'connected', updated_at = now()
        WHERE tenant_id = %s AND source = %s
        """,
        (json.dumps(config), body.schedule_cron, tenant_id, source),
    )
    conn.execute(
        "INSERT INTO ops.audit_log (actor_user_id, tenant_id, action, detail) VALUES (%s,%s,%s,%s)",
        (user["id"], tenant_id, "connection.configure", json.dumps({"source": source})),
    )

    return list_for_tenant(tenant_id, conn, user)[SOURCES.index(source)]


@router.delete("/{source}", status_code=204)
def disconnect(
    tenant_id: str,
    source: str,
    conn: Db,
    user: CurrentUser,
    role: Admin,
) -> None:
    """Forget the credential and mark the connection disconnected.

    The raw lake is untouched, deliberately. Those bytes are evidence of what the
    customer's systems held at a point in time; disconnecting stops us reading
    more, it does not rewrite history. Erasure is a separate, deliberate act --
    which is why every lake key carries the tenant.
    """
    if source not in SOURCES:
        raise HTTPException(status_code=404, detail="unknown source")

    conn.execute(
        "DELETE FROM app.connection_secret WHERE tenant_id = %s AND source = %s",
        (tenant_id, source),
    )
    set_status(conn, tenant_id, source, "disconnected")
    conn.execute(
        "INSERT INTO ops.audit_log (actor_user_id, tenant_id, action, detail) VALUES (%s,%s,%s,%s)",
        (user["id"], tenant_id, "connection.disconnect", json.dumps({"source": source})),
    )


__all__ = ["router"]
