"""Sessions, the signed OAuth ``state``, and PKCE.

Three separate jobs that all look like "a random string" and must not be
conflated:

``state``   proves the callback belongs to the browser that started the flow.
            Signed and time-limited, carrying the tenant and provider it was
            issued for, so a callback cannot be replayed against a *different*
            customer's connection.
``PKCE``    proves the code is redeemed by the client that requested it, even if
            the authorization code leaks in a redirect chain or a log.
``session`` proves who is signed in, and is server-side so that signing out
            revokes rather than merely forgetting.

The session cookie is an opaque id, not a signed claim set. A stateless token
cannot be withdrawn before it expires, and the buttons behind this cookie mint
OAuth tokens to a customer's email and accounting system.
"""

from __future__ import annotations

import base64
import hashlib
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from vcdo.api.settings import SESSION_TTL_DAYS, STATE_TTL_SECONDS

__all__ = [
    "SESSION_COOKIE",
    "StateError",
    "sign_state",
    "read_state",
    "new_pkce",
    "create_session",
    "user_for_session",
    "revoke_session",
    "hash_token",
    "new_invitation_token",
]

SESSION_COOKIE = "vcdo_session"

_STATE_SALT = "vcdo-oauth-state"


class StateError(Exception):
    """The ``state`` did not verify. Treated as hostile, never as a retry."""


@dataclass(frozen=True, slots=True)
class OAuthState:
    provider: str
    tenant_id: str
    session_id: str
    verifier: str
    next_path: str = "/"


def _serializer(secret: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(secret, salt=_STATE_SALT)


def sign_state(secret: str, state: OAuthState) -> str:
    return _serializer(secret).dumps(
        {
            "provider": state.provider,
            "tenant_id": state.tenant_id,
            "session_id": state.session_id,
            "verifier": state.verifier,
            "next_path": state.next_path,
        }
    )


def read_state(secret: str, token: str, *, session_id: str, provider: str) -> OAuthState:
    """Verify a returned ``state``, or raise.

    Binds three things at once: the signature (we issued it), the age (recently),
    and the session (to this browser). The session check is what stops a callback
    captured from one user being replayed by another -- without it a valid,
    unexpired state is a bearer token for attaching an account.
    """
    try:
        data = _serializer(secret).loads(token, max_age=STATE_TTL_SECONDS)
    except SignatureExpired as exc:
        raise StateError("the sign-in attempt expired; start again") from exc
    except BadSignature as exc:
        raise StateError("state did not verify") from exc

    if not isinstance(data, dict):
        raise StateError("state did not verify")
    if not secrets.compare_digest(str(data.get("session_id", "")), session_id):
        raise StateError("state was issued for a different session")
    if data.get("provider") != provider:
        raise StateError("state was issued for a different provider")

    return OAuthState(
        provider=str(data["provider"]),
        tenant_id=str(data.get("tenant_id", "")),
        session_id=str(data["session_id"]),
        verifier=str(data.get("verifier", "")),
        next_path=str(data.get("next_path") or "/"),
    )


def new_pkce() -> tuple[str, str]:
    """A PKCE ``(verifier, challenge)`` pair, S256.

    The plain method is also permitted by the spec and is worthless -- it sends
    the secret as the challenge. Only S256 is generated here.
    """
    verifier = base64.urlsafe_b64encode(os.urandom(64)).decode().rstrip("=")
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return verifier, challenge


def hash_token(token: str) -> str:
    """SHA-256 of a bearer-like token, for storing a lookup key instead of the key.

    Invitations live in the backup set. A leaked dump should not contain working
    invitations, so what is stored is a digest and what is emailed is the token.
    """
    return hashlib.sha256(token.encode()).hexdigest()


def new_invitation_token() -> str:
    return secrets.token_urlsafe(32)


def create_session(conn: Any, user_id: str) -> tuple[str, datetime]:
    expires_at = datetime.now(UTC) + timedelta(days=SESSION_TTL_DAYS)
    row = conn.execute(
        "INSERT INTO app.session (user_id, expires_at) VALUES (%s, %s) RETURNING id",
        (user_id, expires_at),
    ).fetchone()
    return str(row[0]), expires_at


def user_for_session(conn: Any, session_id: str) -> dict | None:
    """The signed-in user, or ``None``.

    Revocation and expiry are checked in SQL rather than in Python so that a
    revoked session cannot be used by a request that read the row a moment
    earlier.
    """
    if not session_id:
        return None
    try:
        row = conn.execute(
            """
            SELECT u.id, u.email, u.display_name, u.is_staff
            FROM app.session s
            JOIN app.app_user u ON u.id = s.user_id
            WHERE s.id = %s
              AND s.revoked_at IS NULL
              AND s.expires_at > now()
            """,
            (session_id,),
        ).fetchone()
    except Exception:
        # A malformed cookie is not a server error; it is a signed-out browser.
        return None
    if row is None:
        return None
    return {
        "id": str(row[0]),
        "email": row[1],
        "display_name": row[2],
        "is_staff": row[3],
    }


def revoke_session(conn: Any, session_id: str) -> None:
    conn.execute(
        "UPDATE app.session SET revoked_at = now() WHERE id = %s AND revoked_at IS NULL",
        (session_id,),
    )
