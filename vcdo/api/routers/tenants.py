"""Tenants, and who may see them.

``ops.tenant.id`` is a CASE-ID and ``display_name`` is the real client name. The
id is what reaches lake keys, log lines and object listings; the name stays in
this table. Creating a tenant therefore *generates* the id rather than letting a
caller supply one -- a helpfully-named id would put a client name into every
object key in the lake, permanently, because the lake is create-only.
"""

from __future__ import annotations

import re
import secrets

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from vcdo.api.deps import CurrentUser, Db, require_member
from vcdo.api.models import TenantOut

router = APIRouter(prefix="/api/tenants", tags=["tenants"])

#: CASE-IDs look like this and nothing else. Checked on the way in as well as
#: generated, because an id from any other path still ends up in a lake key.
CASE_ID = re.compile(r"CASE-[A-Z0-9]{4,12}")


class TenantCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=200)


def new_case_id() -> str:
    """A fresh, meaningless CASE-ID.

    Random rather than sequential: a sequential id leaks how many customers we
    have and lets one customer infer another's existence from their own id.
    """
    return f"CASE-{secrets.token_hex(3).upper()}"


@router.get("")
def list_tenants(conn: Db, user: CurrentUser) -> list[TenantOut]:
    """Every tenant for staff; only their own for everyone else."""
    if user["is_staff"]:
        rows = conn.execute(
            "SELECT id, display_name, status, created_at FROM ops.tenant ORDER BY display_name"
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT t.id, t.display_name, t.status, t.created_at
            FROM ops.tenant t
            JOIN app.tenant_member m ON m.tenant_id = t.id
            WHERE m.user_id = %s
            ORDER BY t.display_name
            """,
            (user["id"],),
        ).fetchall()
    return [TenantOut(id=r[0], display_name=r[1], status=r[2], created_at=r[3]) for r in rows]


@router.post("", status_code=201)
def create_tenant(body: TenantCreate, conn: Db, user: CurrentUser) -> TenantOut:
    if not user["is_staff"]:
        raise HTTPException(status_code=403, detail="only staff can create a tenant")

    tenant_id = new_case_id()
    row = conn.execute(
        "INSERT INTO ops.tenant (id, display_name) VALUES (%s, %s) "
        "RETURNING id, display_name, status, created_at",
        (tenant_id, body.display_name.strip()),
    ).fetchone()
    conn.execute(
        "INSERT INTO ops.audit_log (actor_user_id, tenant_id, action) VALUES (%s,%s,%s)",
        (user["id"], tenant_id, "tenant.create"),
    )
    return TenantOut(id=row[0], display_name=row[1], status=row[2], created_at=row[3])


@router.get("/{tenant_id}")
def get_tenant(tenant_id: str, conn: Db, user: CurrentUser) -> TenantOut:
    # Resolves membership first; a non-member gets 404, never a 403 that would
    # confirm the tenant exists.
    require_member(tenant_id, conn, user)
    row = conn.execute(
        "SELECT id, display_name, status, created_at FROM ops.tenant WHERE id = %s",
        (tenant_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="no such tenant")
    return TenantOut(id=row[0], display_name=row[1], status=row[2], created_at=row[3])


__all__ = ["router", "new_case_id", "CASE_ID"]
