"""Membership and invitations.

An invitation is the only way a non-staff Google account gets in, so this is an
access-control surface rather than an address book. The token is returned **once**
from the create call and stored only as a SHA-256 digest: this table is in the
backup set, and a leaked dump should not contain working invitations.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from vcdo.api.deps import CurrentUser, Db, require_member, require_role
from vcdo.api.models import UserOut
from vcdo.api.security import hash_token, new_invitation_token

router = APIRouter(prefix="/api/tenants/{tenant_id}/members", tags=["members"])

Admin = Annotated[str, Depends(require_role("admin"))]

#: How long an invitation stays valid. Short enough that a forwarded email stops
#: being a key; long enough for someone to act on it after a weekend.
INVITE_TTL_DAYS = 14


class InviteIn(BaseModel):
    email: EmailStr
    role: str = Field(default="member")


@router.get("")
def list_members(tenant_id: str, conn: Db, user: CurrentUser) -> list[UserOut]:
    require_member(tenant_id, conn, user)
    rows = conn.execute(
        """
        SELECT u.id, u.email, u.display_name, u.is_staff, m.role
        FROM app.tenant_member m
        JOIN app.app_user u ON u.id = m.user_id
        WHERE m.tenant_id = %s
        ORDER BY u.email
        """,
        (tenant_id,),
    ).fetchall()
    return [UserOut(id=str(r[0]), email=r[1], display_name=r[2], is_staff=r[3], role=r[4]) for r in rows]


@router.post("/invitations", status_code=201)
def invite(
    tenant_id: str,
    body: InviteIn,
    conn: Db,
    user: CurrentUser,
    role: Admin,
) -> dict:
    """Create an invitation and return its token exactly once."""
    if body.role not in ("admin", "member", "viewer"):
        raise HTTPException(status_code=400, detail="unknown role")

    token = new_invitation_token()
    conn.execute(
        """
        INSERT INTO app.invitation (token_sha256, tenant_id, email, role, invited_by, expires_at)
        VALUES (%s,%s,%s,%s,%s,%s)
        """,
        (
            hash_token(token),
            tenant_id,
            str(body.email).lower(),
            body.role,
            user["id"],
            datetime.now(UTC) + timedelta(days=INVITE_TTL_DAYS),
        ),
    )
    conn.execute(
        "INSERT INTO ops.audit_log (actor_user_id, tenant_id, action, detail) VALUES (%s,%s,%s,%s)",
        (user["id"], tenant_id, "member.invite", json.dumps({"email": str(body.email), "role": body.role})),
    )
    # Returned here and never again; only the digest is stored.
    return {"token": token, "expires_in_days": INVITE_TTL_DAYS}


@router.delete("/{user_id}", status_code=204)
def remove_member(
    tenant_id: str,
    user_id: str,
    conn: Db,
    user: CurrentUser,
    role: Admin,
) -> None:
    conn.execute(
        "DELETE FROM app.tenant_member WHERE tenant_id = %s AND user_id = %s",
        (tenant_id, user_id),
    )
    # Their sessions keep working until they expire unless revoked here, and
    # "removed but still able to act" is the gap this closes.
    conn.execute(
        "UPDATE app.session SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL",
        (user_id,),
    )
    conn.execute(
        "INSERT INTO ops.audit_log (actor_user_id, tenant_id, action, detail) VALUES (%s,%s,%s,%s)",
        (user["id"], tenant_id, "member.remove", json.dumps({"user_id": user_id})),
    )


__all__ = ["router"]
