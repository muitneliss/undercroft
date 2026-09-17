"""Xero: the organisation picker the codebase has promised and never had.

``vcdo/sources/xero.py`` has always documented that "the tenant is verified
before any accounting read... matched by exact name and type, never taken as the
first connection", because the legacy token reached both a real organisation and
a Demo Company. Nothing implemented it. This module is that implementation.

Three specifics that a first pass usually gets wrong:

**``/connections`` is not under the accounting base URL.** It is
``https://api.xero.com/connections``, while every accounting call goes to
``https://api.xero.com/api.xro/2.0``. Building it by appending to the existing
client's base URL 404s.

**Filter on ``tenantType == "ORGANISATION"``.** Practice and demo entries come
back from the same endpoint, and taking ``[0]`` is exactly the "first connection"
the docstring warns against.

**The refresh token rotates and the old one dies on use.** Two concurrent
refreshes do not race to a winner -- they destroy the connection and the customer
has to consent again. :func:`vcdo.core.connections.access_token` takes
``SELECT ... FOR UPDATE`` around this call for that reason.

One more that is not about code: disconnecting an organisation inside Xero does
*not* invalidate the token. It simply stops appearing in ``/connections``. So a
revoked connection surfaces as a successful call returning an empty list, never
as a 401.
"""

from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx

from vcdo.api.oauth.base import HTTP_TIMEOUT, ConnectedAccount, OAuthError
from vcdo.api.settings import load_api_settings, oauth_app
from vcdo.core.connections import Credential

__all__ = ["XeroProvider", "XERO_SCOPES", "CONNECTIONS_URL"]

AUTH_URL = "https://login.xero.com/identity/connect/authorize"
TOKEN_URL = "https://identity.xero.com/connect/token"

#: NOT under the accounting base url. See the module docstring.
CONNECTIONS_URL = "https://api.xero.com/connections"

XERO_SCOPES = (
    "openid",
    "profile",
    "email",
    # Without offline_access there is no refresh token, and access tokens last
    # thirty minutes -- shorter than a real sync.
    "offline_access",
    "accounting.transactions.read",
    "accounting.contacts.read",
    "accounting.settings.read",
)


class XeroProvider:
    name = "xero"
    sources = ("xero",)

    def authorize_url(self, *, state: str, challenge: str, scopes: tuple[str, ...] = ()) -> str:
        app = oauth_app("xero")
        params = {
            "response_type": "code",
            "client_id": app.client_id,
            "redirect_uri": load_api_settings().redirect_uri("xero"),
            "scope": " ".join(scopes or XERO_SCOPES),
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        return f"{AUTH_URL}?{urlencode(params)}"

    def exchange(self, *, code: str, verifier: str) -> Credential:
        app = oauth_app("xero")
        response = httpx.post(
            TOKEN_URL,
            headers={"Authorization": _basic(app.client_id, app.client_secret)},
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": load_api_settings().redirect_uri("xero"),
                "code_verifier": verifier,
            },
            timeout=HTTP_TIMEOUT,
        )
        return _credential(response)

    def refresh(self, refresh_token: str) -> Credential:
        app = oauth_app("xero")
        response = httpx.post(
            TOKEN_URL,
            headers={"Authorization": _basic(app.client_id, app.client_secret)},
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
            timeout=HTTP_TIMEOUT,
        )
        refreshed = _credential(response)
        if not refreshed.refresh_token:
            # Xero always rotates. An empty replacement means we have just spent
            # the only token we had, so say so loudly rather than persisting a
            # credential that cannot be renewed again.
            raise OAuthError("xero refresh returned no new refresh token; the connection is now unusable")
        return refreshed

    def identify(self, credential: Credential) -> ConnectedAccount:
        """List the organisations this token reaches; never assume there is one."""
        response = httpx.get(
            CONNECTIONS_URL,
            headers={
                "Authorization": f"Bearer {credential.access_token}",
                "Accept": "application/json",
            },
            timeout=HTTP_TIMEOUT,
        )
        if response.status_code != 200:
            raise OAuthError(f"xero /connections returned {response.status_code}")

        organisations = [
            {
                "id": entry.get("tenantId") or "",
                "label": entry.get("tenantName") or "",
            }
            # Practice and demo entries come back from the same endpoint.
            for entry in response.json()
            if entry.get("tenantType") == "ORGANISATION"
        ]
        if not organisations:
            raise OAuthError(
                "the Xero authorisation reaches no organisation. If the account was "
                "disconnected inside Xero the token stays valid and simply stops listing it."
            )
        if len(organisations) > 1:
            # Returned for the operator to choose. Picking one here is precisely
            # the "first connection" behaviour vcdo/sources/xero.py warns about.
            return ConnectedAccount(
                external_id="",
                label="",
                scopes=XERO_SCOPES,
                choices=tuple(organisations),
            )
        only = organisations[0]
        return ConnectedAccount(external_id=only["id"], label=only["label"], scopes=XERO_SCOPES)


def _basic(client_id: str, client_secret: str) -> str:
    raw = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    return f"Basic {raw}"


def _credential(response: httpx.Response) -> Credential:
    if response.status_code != 200:
        raise OAuthError(f"xero token endpoint returned {response.status_code}")
    payload = response.json()
    expires_in = payload.get("expires_in")
    return Credential(
        access_token=payload.get("access_token") or "",
        refresh_token=payload.get("refresh_token") or "",
        expires_at=(
            datetime.now(UTC) + timedelta(seconds=int(expires_in)) if expires_in is not None else None
        ),
    )
