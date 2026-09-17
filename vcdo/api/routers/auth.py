"""Sign-in with Google, for both Workspace and personal accounts.

Because personal accounts are supported, **the hosted domain cannot be the
authorisation check**. Anyone with a Gmail address can complete a Google sign-in;
what decides whether they get in is:

1. their email domain is in ``VCDO_SSO_STAFF_DOMAINS`` -- they are staff; or
2. a pending invitation exists for their email -- they join that tenant; or
3. they already have an account from (1) or (2) on a previous visit.

Anything else is refused. An unset ``VCDO_SSO_STAFF_DOMAINS`` therefore means
"nobody is staff by domain", not "everybody is" -- the safe direction, given the
alternative admits every Google account on earth to a console that can connect a
customer's accounting system.

The Google identity used to *sign in* is a different thing from the Google
credential used to *read Gmail*. This flow asks for no data scopes at all.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Cookie, HTTPException, Query, Response
from fastapi.responses import RedirectResponse

from vcdo.api.deps import CurrentUser, Db, Settings
from vcdo.api.oauth.google import GoogleProvider
from vcdo.api.security import (
    SESSION_COOKIE,
    OAuthState,
    StateError,
    create_session,
    hash_token,
    new_pkce,
    read_state,
    revoke_session,
    sign_state,
)
from vcdo.api.settings import SESSION_TTL_DAYS

router = APIRouter(prefix="/api/auth", tags=["auth"])

#: A sign-in flow has no tenant yet, and no session to bind to. This constant
#: stands in for the session id so the state format stays uniform; the callback
#: checks it explicitly rather than comparing against a real session.
_PRE_SESSION = "pre-signin"


@router.get("/login")
def login(settings: Settings, next_path: Annotated[str, Query(alias="next")] = "/") -> RedirectResponse:
    verifier, challenge = new_pkce()
    state = sign_state(
        settings.session_secret,
        OAuthState(
            provider="google",
            tenant_id="",
            session_id=_PRE_SESSION,
            verifier=verifier,
            # Only ever a path. An absolute URL here would make this an open
            # redirect, which is how sign-in pages become phishing infrastructure.
            next_path=next_path if next_path.startswith("/") else "/",
        ),
    )
    url = GoogleProvider().authorize_url(state=state, challenge=challenge, scopes=())
    return RedirectResponse(url, status_code=307)


@router.get("/callback")
def callback(
    conn: Db,
    settings: Settings,
    code: str = "",
    state: str = "",
) -> RedirectResponse:
    if not code:
        raise HTTPException(status_code=400, detail="sign-in was cancelled")

    try:
        verified = read_state(settings.session_secret, state, session_id=_PRE_SESSION, provider="google")
    except StateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    provider = GoogleProvider()
    credential = provider.exchange(code=code, verifier=verified.verifier)
    account = provider.identify(credential)
    email = account.external_id.lower()

    user = _admit(conn, email, account.label, settings.staff_domains)
    session_id, _ = create_session(conn, user["id"])

    redirect = RedirectResponse(verified.next_path, status_code=303)
    redirect.set_cookie(
        SESSION_COOKIE,
        session_id,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=SESSION_TTL_DAYS * 24 * 3600,
        path="/",
    )
    return redirect


def _admit(conn, email: str, display_name: str, staff_domains: tuple[str, ...]) -> dict:
    """Decide whether this Google account may sign in, and on what terms."""
    existing = conn.execute(
        "SELECT id, is_staff FROM app.app_user WHERE lower(email) = %s", (email,)
    ).fetchone()
    if existing is not None:
        conn.execute("UPDATE app.app_user SET last_login_at = now() WHERE id = %s", (existing[0],))
        return {"id": str(existing[0]), "is_staff": existing[1]}

    domain = email.rpartition("@")[2]
    is_staff = domain in staff_domains

    invitation = None
    if not is_staff:
        invitation = conn.execute(
            """
            SELECT token_sha256, tenant_id, role FROM app.invitation
            WHERE lower(email) = %s AND accepted_at IS NULL AND expires_at > now()
            ORDER BY created_at DESC LIMIT 1
            """,
            (email,),
        ).fetchone()
        if invitation is None:
            # Not 403 with an explanation of what would let them in: that turns
            # this endpoint into a way to discover which domains are staff.
            raise HTTPException(status_code=403, detail="this account has not been invited")

    row = conn.execute(
        """
        INSERT INTO app.app_user (email, display_name, is_staff, last_login_at)
        VALUES (%s, %s, %s, now()) RETURNING id
        """,
        (email, display_name, is_staff),
    ).fetchone()
    user_id = str(row[0])

    if invitation is not None:
        conn.execute(
            "INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES (%s,%s,%s) "
            "ON CONFLICT DO NOTHING",
            (invitation[1], user_id, invitation[2]),
        )
        conn.execute(
            "UPDATE app.invitation SET accepted_at = now() WHERE token_sha256 = %s",
            (invitation[0],),
        )

    return {"id": user_id, "is_staff": is_staff}


@router.get("/session")
def whoami(user: CurrentUser) -> dict:
    return user


@router.post("/logout")
def logout(
    conn: Db,
    response: Response,
    session_id: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> dict:
    """Revoke server-side, then clear the cookie.

    In that order: clearing the cookie alone would leave a session id that still
    works if it was captured.
    """
    if session_id:
        revoke_session(conn, session_id)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"signed_out": True}


__all__ = ["router", "hash_token"]
