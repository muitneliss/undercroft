"""Connecting a customer's account: the redirect out, and the callback back.

The ``state`` is signed, time-limited and bound to **both** the browser session
and the tenant it was issued for. That last binding is the one that is easy to
omit and expensive to omit: without it, a valid unexpired state is a bearer token
for attaching an account, and a callback captured during one tenant's setup could
be replayed to attach that account to a different customer.

The credential is stored **before** the connection is marked usable, and the
connection is left in ``needs_scope`` until the operator chooses what to sync.
The alternative ordering -- mark connected, store the token afterwards -- leaves
a window where the UI shows a working connection whose every run fails.
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse

from vcdo.api.deps import CurrentUser, Db, Settings, require_member, require_role
from vcdo.api.oauth.base import SOURCE_PROVIDER, OAuthError, provider_for
from vcdo.api.oauth.google import DRIVE_SCOPES, GMAIL_SCOPES
from vcdo.api.security import SESSION_COOKIE, OAuthState, StateError, new_pkce, read_state, sign_state
from vcdo.core.connections import upsert_connection, write_credential

router = APIRouter(prefix="/api", tags=["oauth"])

Admin = Annotated[str, Depends(require_role("admin"))]


def _scopes_for(source: str) -> tuple[str, ...]:
    """Ask only for what this source needs.

    Gmail and Drive share one Google application but not one consent: connecting
    Drive must not request the ability to read a customer's email. Asking for
    both at once would also mean a single decline breaks both.
    """
    return {"gmail": GMAIL_SCOPES, "drive": DRIVE_SCOPES}.get(source, ())


@router.get("/tenants/{tenant_id}/connections/{source}/authorize")
def authorize(
    tenant_id: str,
    source: str,
    conn: Db,
    user: CurrentUser,
    settings: Settings,
    role: Admin,
    session_id: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> RedirectResponse:
    provider_name = SOURCE_PROVIDER.get(source)
    if provider_name is None:
        raise HTTPException(status_code=404, detail="unknown source")

    verifier, challenge = new_pkce()
    state = sign_state(
        settings.session_secret,
        OAuthState(
            provider=provider_name,
            # Carried in the signed state, so the callback attaches the account
            # to the tenant the flow STARTED for -- not to whatever tenant the
            # browser happens to be looking at when it returns.
            tenant_id=f"{tenant_id}:{source}",
            session_id=session_id or "",
            verifier=verifier,
            next_path=f"/tenants/{tenant_id}",
        ),
    )
    url = provider_for(provider_name).authorize_url(
        state=state, challenge=challenge, scopes=_scopes_for(source)
    )
    return RedirectResponse(url, status_code=307)


@router.get("/oauth/{provider_name}/callback")
def callback(
    provider_name: str,
    conn: Db,
    user: CurrentUser,
    settings: Settings,
    code: Annotated[str, Query()] = "",
    state: Annotated[str, Query()] = "",
    session_id: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> RedirectResponse:
    if not code:
        raise HTTPException(status_code=400, detail="the authorisation was cancelled")

    try:
        verified = read_state(
            settings.session_secret, state, session_id=session_id or "", provider=provider_name
        )
    except StateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    tenant_id, _, source = verified.tenant_id.partition(":")
    if not tenant_id or not source:
        raise HTTPException(status_code=400, detail="state did not name a connection")

    # Re-checked here, not merely at /authorize. The state proves the flow
    # started legitimately; it does not prove the user still has the role.
    role = require_member(tenant_id, conn, user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="requires admin")

    provider = provider_for(provider_name)
    try:
        credential = provider.exchange(code=code, verifier=verified.verifier)
        account = provider.identify(credential)
    except OAuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if account.choices:
        # Xero with more than one organisation. Store the credential so the
        # operator does not have to consent again, and leave the connection
        # unusable until they say which organisation is theirs. Choosing for them
        # is exactly the "never taken as the first connection" failure.
        upsert_connection(conn, tenant_id, source, status="needs_scope")
        write_credential(conn, tenant_id, source, credential)
        return RedirectResponse(f"/tenants/{tenant_id}/connect/{source}/choose", status_code=303)

    upsert_connection(
        conn,
        tenant_id,
        source,
        status="needs_scope",
        external_account_id=account.external_id,
        external_account_label=account.label,
        scopes=account.scopes,
        config=account.config,
    )
    # Written after the row exists, because the secret table references it.
    write_credential(conn, tenant_id, source, credential)
    conn.execute(
        "INSERT INTO ops.audit_log (actor_user_id, tenant_id, action, detail) VALUES (%s,%s,%s,%s)",
        (
            user["id"],
            tenant_id,
            "connection.connect",
            json.dumps({"source": source, "account": account.label}),
        ),
    )
    return RedirectResponse(f"/tenants/{tenant_id}/connect/{source}/scope", status_code=303)


__all__ = ["router"]
