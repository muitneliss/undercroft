"""Browsing the raw lake, within one tenant's prefix.

Every listing is rooted at the tenant's own prefixes and cannot be talked out of
them. That is why the tenant leads every lake key: without it, scoping a browser
to one customer would mean filtering results after listing everything, and a
filter that is one bug away from showing another customer's object names is not
a boundary.

**Metadata by default; bytes only on request.** A manifest says what a document
is, when it was observed and what it hashes to, and that is enough to answer most
questions. The bytes are the customer's actual invoices and email attachments, so
fetching them is a separate, role-gated, audited act.
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from vcdo.api.deps import CurrentUser, Db, require_member, require_role
from vcdo.api.models import LakeObjectOut

router = APIRouter(prefix="/api/tenants/{tenant_id}/lake", tags=["lake"])

Admin = Annotated[str, Depends(require_role("admin"))]


#: The prefixes a tenant's data can live under. Everything else is out of bounds
#: -- including `_blobs/`, which is content-addressed and therefore shared across
#: tenants: two customers holding an identical PDF share one blob, so exposing
#: that namespace would leak the fact.
def tenant_prefixes(tenant_id: str) -> tuple[str, ...]:
    return (
        f"records/hubspot/{tenant_id}/",
        f"records/xero/{tenant_id}/",
        f"records/gmail/{tenant_id}/",
        f"records/drive/{tenant_id}/",
        f"gmail/{tenant_id}/",
        f"drive/{tenant_id}/",
    )


def _check_prefix(tenant_id: str, prefix: str) -> str:
    """Refuse any prefix that is not inside this tenant's own space."""
    allowed = tenant_prefixes(tenant_id)
    if not prefix:
        return ""
    if not any(prefix.startswith(p) or p.startswith(prefix) for p in allowed):
        raise HTTPException(status_code=403, detail="that prefix is outside this tenant")
    return prefix


def _store():
    from vcdo.core.config import load
    from vcdo.lake.s3 import from_config
    from vcdo.lake.store import LakeStore

    backing = from_config(load())
    return LakeStore(backing), backing


@router.get("")
def browse(
    tenant_id: str,
    conn: Db,
    user: CurrentUser,
    prefix: Annotated[str, Query()] = "",
    limit: int = 200,
) -> list[LakeObjectOut]:
    require_member(tenant_id, conn, user)
    _check_prefix(tenant_id, prefix)

    lake, backing = _store()
    prefixes = (prefix,) if prefix else tenant_prefixes(tenant_id)

    seen: dict[str, int] = {}
    for root in prefixes:
        for key in backing.list(root):
            # A stored object is `<source_key>/<stamp>/manifest.json`; the source
            # key is what a human browses, so the versions collapse into a count.
            source_key = key.rsplit("/", 2)[0] if key.endswith("/manifest.json") else key
            seen[source_key] = seen.get(source_key, 0) + 1
            if len(seen) >= limit:
                break

    return [
        LakeObjectOut(key=key, versions=count, newest_sha256=lake.newest_sha(key))
        for key, count in sorted(seen.items())
    ]


@router.get("/object")
def manifest(
    tenant_id: str,
    conn: Db,
    user: CurrentUser,
    key: Annotated[str, Query()],
) -> dict:
    """The manifests for one object: provenance without the payload."""
    require_member(tenant_id, conn, user)
    _check_prefix(tenant_id, key)

    lake, _ = _store()
    stamps = lake.versions(key)
    if not stamps:
        raise HTTPException(status_code=404, detail="no such object")
    return {
        "key": key,
        "versions": [{"stamp": s, **lake.manifest(key, s)} for s in stamps],
    }


@router.get("/download")
def download(
    tenant_id: str,
    conn: Db,
    user: CurrentUser,
    role: Admin,
    key: Annotated[str, Query()],
    stamp: Annotated[str | None, Query()] = None,
) -> Response:
    """The actual bytes. Admin only, and written to the audit log.

    These are the customer's invoices and email attachments. Reading one is a
    deliberate act by a named person, not a side effect of browsing.
    """
    _check_prefix(tenant_id, key)

    lake, _ = _store()
    try:
        data = lake.read(key, stamp)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="no such object") from exc

    conn.execute(
        "INSERT INTO ops.audit_log (actor_user_id, tenant_id, action, detail) VALUES (%s,%s,%s,%s)",
        (user["id"], tenant_id, "lake.download", json.dumps({"key": key})),
    )
    return Response(content=data, media_type="application/octet-stream")


__all__ = ["router", "tenant_prefixes"]
