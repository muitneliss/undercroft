"""Google: one consent, two sources (Gmail metadata and Drive documents).

**``prompt=consent`` is not optional here, and its absence is the single most
common way this integration ships broken.** Google returns a refresh token only
on the *first* consent for a given client/user pair. A user who has authorised
before gets an access token and no refresh token, everything works for an hour,
and the connection then dies with no obvious cause. Forcing the consent screen
every time costs one extra click and removes the failure entirely.

**Scopes are restricted, and that is a business constraint before it is a
technical one.** ``gmail.readonly`` and ``drive.readonly`` are *restricted*
scopes: serving them to non-Workspace accounts requires Google verification plus
an annual third-party CASA security assessment. ``drive.file`` is listed here as
the narrower alternative because it is **not** restricted -- it reaches only
files the user picked -- and choosing it removes half the exposure. There is no
equivalent narrowing for reading Gmail. See ADR 0004's risk note.

**A partial grant is a real outcome.** One consent screen offers both scopes and
the user may approve one. The returned ``scope`` string is authoritative, and
acting on what we *asked* for rather than what we were *given* produces a Drive
sync that 403s on every call.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx

from vcdo.api.oauth.base import HTTP_TIMEOUT, ConnectedAccount, OAuthError
from vcdo.api.settings import load_api_settings, oauth_app
from vcdo.core.connections import Credential

__all__ = ["GoogleProvider", "GMAIL_SCOPES", "DRIVE_SCOPES", "DRIVE_SCOPES_NARROW"]

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

#: Restricted. Requires verification + CASA for external users.
GMAIL_SCOPES = ("https://www.googleapis.com/auth/gmail.readonly",)

#: Restricted, for the same reason.
DRIVE_SCOPES = ("https://www.googleapis.com/auth/drive.readonly",)

#: NOT restricted: reaches only what the user selected through the Picker. The
#: cheaper path to production if the verification timeline bites.
DRIVE_SCOPES_NARROW = ("https://www.googleapis.com/auth/drive.file",)

#: Always requested, so we can name the account we just connected.
IDENTITY_SCOPES = ("openid", "email", "profile")


class GoogleProvider:
    name = "google"
    sources = ("gmail", "drive")

    def authorize_url(self, *, state: str, challenge: str, scopes: tuple[str, ...]) -> str:
        app = oauth_app("google")
        params = {
            "client_id": app.client_id,
            "redirect_uri": load_api_settings().redirect_uri("google"),
            "response_type": "code",
            "scope": " ".join(IDENTITY_SCOPES + scopes),
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            # offline: we need a refresh token at all.
            "access_type": "offline",
            # consent: we need one on a REPEAT authorisation too. Without this a
            # returning user yields no refresh token and the connection dies an
            # hour later. See the module docstring.
            "prompt": "consent",
            "include_granted_scopes": "true",
        }
        return f"{AUTH_URL}?{urlencode(params)}"

    def exchange(self, *, code: str, verifier: str) -> Credential:
        app = oauth_app("google")
        response = httpx.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": app.client_id,
                "client_secret": app.client_secret,
                "redirect_uri": load_api_settings().redirect_uri("google"),
                "grant_type": "authorization_code",
                "code_verifier": verifier,
            },
            timeout=HTTP_TIMEOUT,
        )
        return _credential(response, require_refresh=True)

    def refresh(self, refresh_token: str) -> Credential:
        app = oauth_app("google")
        response = httpx.post(
            TOKEN_URL,
            data={
                "refresh_token": refresh_token,
                "client_id": app.client_id,
                "client_secret": app.client_secret,
                "grant_type": "refresh_token",
            },
            timeout=HTTP_TIMEOUT,
        )
        refreshed = _credential(response, require_refresh=False)
        # Google does not rotate the refresh token, and returns no new one. Carry
        # the existing one forward rather than storing an empty string, which
        # would look like "cannot be refreshed" on the next run.
        return Credential(
            access_token=refreshed.access_token,
            refresh_token=refreshed.refresh_token or refresh_token,
            expires_at=refreshed.expires_at,
        )

    def identify(self, credential: Credential) -> ConnectedAccount:
        response = httpx.get(
            USERINFO_URL,
            headers={"Authorization": f"Bearer {credential.access_token}"},
            timeout=HTTP_TIMEOUT,
        )
        if response.status_code != 200:
            raise OAuthError(f"google userinfo returned {response.status_code}")
        info = response.json()
        email = info.get("email") or ""
        if not email:
            raise OAuthError("google returned no email; cannot name the connected account")
        return ConnectedAccount(external_id=email, label=email)


def granted_scopes(response_scope: str) -> tuple[str, ...]:
    """What the user actually approved.

    Authoritative over what we asked for. A user may approve Gmail and decline
    Drive on the same screen, and a Drive sync built on the assumption that both
    were granted 403s on every call instead of reporting a missing scope.
    """
    return tuple(s for s in (response_scope or "").split(" ") if s)


def _credential(response: httpx.Response, *, require_refresh: bool) -> Credential:
    if response.status_code != 200:
        raise OAuthError(f"google token endpoint returned {response.status_code}")
    payload = response.json()

    refresh_token = payload.get("refresh_token") or ""
    if require_refresh and not refresh_token:
        # Refusing here rather than storing a credential that will expire in an
        # hour with no way to renew it. The cause is almost always a missing
        # prompt=consent on a repeat authorisation.
        raise OAuthError(
            "google returned no refresh token. This happens on a repeat authorisation "
            "without prompt=consent; the connection would stop working within the hour."
        )

    expires_in = payload.get("expires_in")
    expires_at = datetime.now(UTC) + timedelta(seconds=int(expires_in)) if expires_in is not None else None
    return Credential(
        access_token=payload.get("access_token") or "",
        refresh_token=refresh_token,
        expires_at=expires_at,
    )
