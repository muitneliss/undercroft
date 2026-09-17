"""HubSpot: an OAuth app, and the portal check the pipeline has always promised.

``vcdo/cli/pipeline.py`` records that the legacy ingest "aborts before any CRM
read if the connected portal is not the expected one, because syncing the wrong
tenant into a shared lake is very hard to unpick afterwards". The check needs a
portal id, and ``GET /oauth/v1/access-tokens/{token}`` is where it comes from.

**A private-app token cannot serve this platform.** It is issued per portal by
that portal's own admin, has no refresh, and would mean asking every customer to
create one by hand and re-issue it whenever it is rotated. An OAuth app is the
only shape that works for more than one customer, which is why there is no
"paste a token" path here.

**Scopes must match the app's configured set exactly**, or the exchange fails
with ``MISSING_SCOPES`` and no indication of which one. Note especially that the
v4 associations route the source uses needs ``crm.objects.companies.read`` in
addition to the deals scope -- associations are the deal→company edge, not a CRM
object, and it is easy to omit.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx

from vcdo.api.oauth.base import HTTP_TIMEOUT, ConnectedAccount, OAuthError
from vcdo.api.settings import load_api_settings, oauth_app
from vcdo.core.connections import Credential

__all__ = ["HubSpotProvider", "HUBSPOT_SCOPES"]

AUTH_URL = "https://app.hubspot.com/oauth/authorize"
TOKEN_URL = "https://api.hubapi.com/oauth/v1/token"
TOKEN_INFO_URL = "https://api.hubapi.com/oauth/v1/access-tokens"

HUBSPOT_SCOPES = (
    "oauth",
    "crm.objects.contacts.read",
    # Required by the v4 associations batch route as well as by deals
    # themselves; omitting it fails the exchange with MISSING_SCOPES.
    "crm.objects.companies.read",
    "crm.objects.deals.read",
)


class HubSpotProvider:
    name = "hubspot"
    sources = ("hubspot",)

    def authorize_url(self, *, state: str, challenge: str = "", scopes: tuple[str, ...] = ()) -> str:
        """HubSpot does not support PKCE; ``challenge`` is accepted and unused.

        The signed, session-bound ``state`` is what protects this flow. Sending a
        ``code_challenge`` HubSpot ignores would suggest a protection that is not
        there, so it is deliberately not sent.
        """
        app = oauth_app("hubspot")
        params = {
            "client_id": app.client_id,
            "redirect_uri": load_api_settings().redirect_uri("hubspot"),
            "scope": " ".join(scopes or HUBSPOT_SCOPES),
            "state": state,
        }
        return f"{AUTH_URL}?{urlencode(params)}"

    def exchange(self, *, code: str, verifier: str = "") -> Credential:
        app = oauth_app("hubspot")
        response = httpx.post(
            TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "client_id": app.client_id,
                "client_secret": app.client_secret,
                "redirect_uri": load_api_settings().redirect_uri("hubspot"),
                "code": code,
            },
            timeout=HTTP_TIMEOUT,
        )
        return _credential(response)

    def refresh(self, refresh_token: str) -> Credential:
        app = oauth_app("hubspot")
        response = httpx.post(
            TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "client_id": app.client_id,
                "client_secret": app.client_secret,
                "refresh_token": refresh_token,
            },
            timeout=HTTP_TIMEOUT,
        )
        refreshed = _credential(response)
        # HubSpot's refresh token does not expire and is not always re-issued.
        return Credential(
            access_token=refreshed.access_token,
            refresh_token=refreshed.refresh_token or refresh_token,
            expires_at=refreshed.expires_at,
        )

    def identify(self, credential: Credential) -> ConnectedAccount:
        """Ask HubSpot which portal this token belongs to.

        This is the check pipeline.py has documented since the beginning: the
        portal id recorded here is what a later sync compares against, so
        connecting the wrong portal is caught at connect time rather than after
        another customer's CRM has been landed in our lake.
        """
        response = httpx.get(
            f"{TOKEN_INFO_URL}/{credential.access_token}",
            timeout=HTTP_TIMEOUT,
        )
        if response.status_code != 200:
            raise OAuthError(f"hubspot token introspection returned {response.status_code}")
        info = response.json()
        hub_id = info.get("hub_id")
        if hub_id is None:
            raise OAuthError("hubspot returned no hub_id; cannot identify the connected portal")
        return ConnectedAccount(
            external_id=str(hub_id),
            label=str(info.get("hub_domain") or hub_id),
            scopes=tuple(info.get("scopes") or ()),
        )


def _credential(response: httpx.Response) -> Credential:
    if response.status_code != 200:
        # The body names the missing scope when that is the cause, and it is the
        # one piece of the message worth surfacing to an operator.
        try:
            detail = str(response.json().get("message") or "")[:200]
        except Exception:
            detail = ""
        suffix = f": {detail}" if detail else ""
        raise OAuthError(f"hubspot token endpoint returned {response.status_code}{suffix}")

    payload = response.json()
    expires_in = payload.get("expires_in")
    return Credential(
        access_token=payload.get("access_token") or "",
        refresh_token=payload.get("refresh_token") or "",
        expires_at=(
            datetime.now(UTC) + timedelta(seconds=int(expires_in)) if expires_in is not None else None
        ),
    )
