"""The shape every OAuth provider adapter satisfies."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from vcdo.core.connections import Credential

__all__ = ["ConnectedAccount", "OAuthError", "Provider", "provider_for", "HTTP_TIMEOUT"]

#: Outbound timeout. A provider that hangs must not hold a request thread open
#: for the browser's full patience; the operator gets a clear failure instead.
HTTP_TIMEOUT = 20.0


class OAuthError(Exception):
    """The provider refused, or answered something we will not act on."""


@dataclass(frozen=True, slots=True)
class ConnectedAccount:
    """Whose account we just connected, as the provider itself reports it.

    ``external_id`` is THEIRS -- a portal id, an organisation uuid, a mailbox.
    It is never our tenant id, and the two were conflated once already; see
    :mod:`vcdo.sources.xero`.

    ``choices`` is for providers where one consent can reach several accounts and
    the operator must pick. Empty means the account was unambiguous.
    """

    external_id: str
    label: str
    scopes: tuple[str, ...] = ()
    choices: tuple[dict[str, str], ...] = ()
    config: dict[str, Any] = field(default_factory=dict)


class Provider(Protocol):
    name: str
    #: Sources this provider's credential can serve. Google is one consent for
    #: two sources, which is why this is a tuple rather than a single name.
    sources: tuple[str, ...]

    def authorize_url(self, *, state: str, challenge: str, scopes: tuple[str, ...]) -> str: ...

    def exchange(self, *, code: str, verifier: str) -> Credential: ...

    def identify(self, credential: Credential) -> ConnectedAccount: ...

    def refresh(self, refresh_token: str) -> Credential: ...


def provider_for(name: str) -> Provider:
    from vcdo.api.oauth.google import GoogleProvider
    from vcdo.api.oauth.hubspot import HubSpotProvider
    from vcdo.api.oauth.xero import XeroProvider

    providers = {
        "google": GoogleProvider,
        "xero": XeroProvider,
        "hubspot": HubSpotProvider,
    }
    if name not in providers:
        raise OAuthError(f"unknown provider {name!r}; known: {', '.join(sorted(providers))}")
    return providers[name]()


#: Which provider serves which source. Gmail and Drive share one Google consent.
SOURCE_PROVIDER = {
    "gmail": "google",
    "drive": "google",
    "xero": "xero",
    "hubspot": "hubspot",
}
