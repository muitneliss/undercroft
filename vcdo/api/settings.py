"""Control plane settings, resolved from the environment when they are used.

Deliberately not part of :class:`vcdo.core.config.Config`. That object is frozen,
logged, and built by tests with an empty environment; adding required OAuth
secrets to it would fail every one of those tests and would put client secrets
into something that is reprd freely.

Same posture as :mod:`vcdo.core.secrets`: read at the point of use, fail loudly
and by name when absent, and never at import.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

__all__ = ["ApiSettings", "MissingSetting", "load_api_settings", "OAuthApp", "oauth_app"]

#: How long a signed OAuth `state` stays valid. Long enough for a human to read a
#: Google consent screen, short enough that a leaked link is not a standing key.
STATE_TTL_SECONDS = 600

#: Session lifetime. This surface can mint tokens to a customer's accounting
#: system, so it is days, not months.
SESSION_TTL_DAYS = 7


class MissingSetting(Exception):
    """A required control-plane setting is absent or empty."""


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise MissingSetting(
            f"{name} is required by the control plane but is unset or empty. In Dokploy, "
            "a variable set in the UI is not injected automatically -- map it explicitly "
            "in the compose `environment:` block."
        )
    return value


@dataclass(frozen=True, slots=True)
class ApiSettings:
    base_url: str
    session_secret: str
    staff_domains: tuple[str, ...]
    worker_url: str
    trigger_token: str

    def redirect_uri(self, provider: str) -> str:
        return f"{self.base_url.rstrip('/')}/api/oauth/{provider}/callback"


def load_api_settings() -> ApiSettings:
    raw_domains = os.environ.get("VCDO_SSO_STAFF_DOMAINS", "").strip()
    return ApiSettings(
        base_url=_require("VCDO_API_BASE_URL"),
        session_secret=_require("VCDO_SESSION_SECRET"),
        # Empty is allowed and means "nobody is staff by domain". Every account
        # then needs an invitation, which is a safe default rather than an open
        # one -- the unsafe direction would be treating an unset value as "any
        # domain is staff".
        staff_domains=tuple(d.strip().lower() for d in raw_domains.split(",") if d.strip()),
        # The `vcdo-` prefixed alias, not `worker`. Any service with a domain
        # joins the shared dokploy-network, where bare names resolve to whatever
        # another project happens to have called its container.
        worker_url=os.environ.get("VCDO_WORKER_URL", "http://vcdo-worker:8081").strip(),
        trigger_token=_require("VCDO_TRIGGER_TOKEN"),
    )


@dataclass(frozen=True, slots=True)
class OAuthApp:
    """Our registered application with one provider. Not a customer's credential."""

    provider: str
    client_id: str
    client_secret: str


def oauth_app(provider: str) -> OAuthApp:
    prefix = {"google": "GOOGLE", "xero": "XERO", "hubspot": "HUBSPOT"}.get(provider)
    if prefix is None:
        raise MissingSetting(f"no OAuth application is configured for {provider!r}")
    return OAuthApp(
        provider=provider,
        client_id=_require(f"VCDO_{prefix}_CLIENT_ID"),
        client_secret=_require(f"VCDO_{prefix}_CLIENT_SECRET"),
    )
