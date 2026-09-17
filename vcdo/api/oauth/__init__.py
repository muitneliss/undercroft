"""OAuth provider adapters.

One module per provider, each answering the same three questions: where to send
the browser, how to turn the returned code into a credential, and which account
we ended up connected to. That last one is not decoration -- connecting the wrong
account and syncing it into a shared lake is very hard to unpick afterwards, and
every provider here has a documented way to ask "whose data is this token for".

Each adapter also supplies a ``refresh`` callable for
:func:`vcdo.core.connections.access_token`, which keeps the registry free of HTTP
and testable offline.
"""

from vcdo.api.oauth.base import ConnectedAccount, OAuthError, provider_for

__all__ = ["ConnectedAccount", "OAuthError", "provider_for"]
