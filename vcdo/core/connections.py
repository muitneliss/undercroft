"""The connection registry: which customer has connected what, and with which credential.

This replaces ``VCDO_<SOURCE>_CREDENTIALS`` -- one global environment variable
per source, which could describe exactly one customer and could not be rewritten
while the process ran. Both limits are fatal for a platform whose whole schema is
tenant-scoped: the lake key, every curated table and migration 006's aggregate
all key on a tenant that the credential layer had no way to name.

Two tables, deliberately split (migration 007 explains at length):

``ops.connection``
    Status, the external account, the chosen scope. No secret material, so it can
    stay readable by BI and by the operator UI.

``app.connection_secret``
    The sealed credential, same key, in a schema the BI role has no access to.

**Credentials are stored as one sealed JSON bundle**, not as separate columns.
Google hands back a credential object, Xero a rotating pair, HubSpot a pair with
a fixed refresh token; a column per field would be a union of three shapes, most
of it null. ``expires_at`` is *also* kept in the clear beside the ciphertext, so
"which connections need attention" is a query rather than a decrypt-everything
loop.

**Refreshing takes a row lock.** Xero rotates its refresh token and invalidates
the old one the moment it is used, so two concurrent refreshes do not race --
they permanently destroy the connection, and the customer has to re-consent.
``SELECT ... FOR UPDATE`` is what makes that impossible rather than unlikely.

This module holds no HTTP. The provider adapters in :mod:`vcdo.api.oauth` supply
a refresher callable, which keeps the registry testable offline against a real
in-memory refresher instead of a patched one.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from vcdo.core.secrets import Sealed, seal, unseal

__all__ = [
    "Connection",
    "Credential",
    "ConnectionError",
    "SOURCES",
    "STATUSES",
    "REFRESH_SKEW",
    "list_connections",
    "get_connection",
    "upsert_connection",
    "set_status",
    "read_credential",
    "write_credential",
    "needs_refresh",
    "access_token",
]

#: Mirrors vcdo.core.config.SOURCES and migration 007's CHECK constraint. Three
#: copies, and that is the point: a typo fails at the boundary it crosses rather
#: than becoming a row nobody queries.
SOURCES = ("hubspot", "xero", "gmail", "drive")

STATUSES = ("disconnected", "connected", "needs_scope", "needs_reconnect")

#: Refresh this far before the token actually expires. A sync takes minutes and
#: Xero's access tokens last thirty, so a token that is merely "still valid" at
#: the start of a run is not valid enough.
REFRESH_SKEW = timedelta(minutes=5)


class ConnectionError(Exception):  # noqa: A001 - domain term; shadowing is contained to this module
    """The registry cannot produce a usable connection, and will not invent one."""


@dataclass(frozen=True, slots=True)
class Credential:
    """What a provider gave us. Sealed as JSON; never logged."""

    access_token: str
    refresh_token: str = ""
    expires_at: datetime | None = None

    def as_json(self) -> str:
        return json.dumps(
            {
                "access_token": self.access_token,
                "refresh_token": self.refresh_token,
                "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            }
        )

    @staticmethod
    def from_json(blob: str) -> Credential:
        data = json.loads(blob)
        raw_expiry = data.get("expires_at")
        return Credential(
            access_token=data.get("access_token") or "",
            refresh_token=data.get("refresh_token") or "",
            expires_at=datetime.fromisoformat(raw_expiry) if raw_expiry else None,
        )


@dataclass(frozen=True, slots=True)
class Connection:
    """One row of ``ops.connection``. Carries no secret."""

    tenant_id: str
    source: str
    status: str
    external_account_id: str = ""
    external_account_label: str = ""
    scopes: tuple[str, ...] = ()
    config: dict[str, Any] = field(default_factory=dict)
    schedule_cron: str = ""
    last_run_id: str = ""

    @property
    def is_usable(self) -> bool:
        """Connected, and not awaiting operator input.

        ``needs_scope`` is usable-adjacent and deliberately not usable: a Drive
        connection with no folders selected would otherwise run and copy nothing,
        reporting success.
        """
        return self.status == "connected"


def _row_to_connection(row: tuple) -> Connection:
    return Connection(
        tenant_id=row[0],
        source=row[1],
        status=row[2],
        external_account_id=row[3],
        external_account_label=row[4],
        scopes=tuple(row[5] or ()),
        config=row[6] or {},
        schedule_cron=row[7],
        last_run_id=row[8],
    )


_SELECT = """
    SELECT tenant_id, source, status, external_account_id, external_account_label,
           scopes, config, schedule_cron, last_run_id
    FROM ops.connection
"""


def list_connections(conn: Any, tenant_id: str) -> list[Connection]:
    """Every connection for one tenant, ordered so output is stable."""
    rows = conn.execute(_SELECT + " WHERE tenant_id = %s ORDER BY source", (tenant_id,)).fetchall()
    return [_row_to_connection(r) for r in rows]


def get_connection(conn: Any, tenant_id: str, source: str) -> Connection | None:
    """One connection, or ``None``. Absence is a real answer, not an error."""
    row = conn.execute(_SELECT + " WHERE tenant_id = %s AND source = %s", (tenant_id, source)).fetchone()
    return _row_to_connection(row) if row else None


def upsert_connection(
    conn: Any,
    tenant_id: str,
    source: str,
    *,
    status: str = "connected",
    external_account_id: str = "",
    external_account_label: str = "",
    scopes: tuple[str, ...] = (),
    config: dict[str, Any] | None = None,
) -> None:
    if source not in SOURCES:
        raise ConnectionError(f"unknown source {source!r}; known: {', '.join(SOURCES)}")
    if status not in STATUSES:
        raise ConnectionError(f"unknown status {status!r}; known: {', '.join(STATUSES)}")

    conn.execute(
        """
        INSERT INTO ops.connection (
            tenant_id, source, status, external_account_id, external_account_label,
            scopes, config, connected_at, updated_at
        ) VALUES (%s,%s,%s,%s,%s,%s,%s, now(), now())
        ON CONFLICT (tenant_id, source) DO UPDATE SET
            status                 = EXCLUDED.status,
            external_account_id    = EXCLUDED.external_account_id,
            external_account_label = EXCLUDED.external_account_label,
            scopes                 = EXCLUDED.scopes,
            config                 = EXCLUDED.config,
            updated_at             = now()
        """,
        (
            tenant_id,
            source,
            status,
            external_account_id,
            external_account_label,
            list(scopes),
            json.dumps(config or {}),
        ),
    )


def set_status(conn: Any, tenant_id: str, source: str, status: str) -> None:
    """Move a connection's status, e.g. to ``needs_reconnect`` after a revoked grant."""
    if status not in STATUSES:
        raise ConnectionError(f"unknown status {status!r}; known: {', '.join(STATUSES)}")
    conn.execute(
        "UPDATE ops.connection SET status = %s, updated_at = now() WHERE tenant_id = %s AND source = %s",
        (status, tenant_id, source),
    )


def write_credential(conn: Any, tenant_id: str, source: str, credential: Credential) -> None:
    """Seal and store. ``expires_at`` is duplicated in the clear, on purpose."""
    sealed = seal(credential.as_json())
    conn.execute(
        """
        INSERT INTO app.connection_secret (
            tenant_id, source, ciphertext, nonce, key_version, expires_at, updated_at
        ) VALUES (%s,%s,%s,%s,%s,%s, now())
        ON CONFLICT (tenant_id, source) DO UPDATE SET
            ciphertext  = EXCLUDED.ciphertext,
            nonce       = EXCLUDED.nonce,
            key_version = EXCLUDED.key_version,
            expires_at  = EXCLUDED.expires_at,
            updated_at  = now()
        """,
        (
            tenant_id,
            source,
            sealed.ciphertext,
            sealed.nonce,
            sealed.key_version,
            credential.expires_at,
        ),
    )


def read_credential(conn: Any, tenant_id: str, source: str, *, for_update: bool = False) -> Credential:
    """Open the sealed credential.

    ``for_update`` takes a row lock, which callers that are about to refresh must
    use: Xero invalidates a refresh token the moment it is exchanged, so two
    concurrent refreshes do not merely race -- they destroy the connection.
    """
    row = conn.execute(
        "SELECT ciphertext, nonce, key_version FROM app.connection_secret "
        "WHERE tenant_id = %s AND source = %s" + (" FOR UPDATE" if for_update else ""),
        (tenant_id, source),
    ).fetchone()
    if row is None:
        raise ConnectionError(
            f"no stored credential for tenant {tenant_id!r} source {source!r}; "
            "the connection has not completed its OAuth flow"
        )
    sealed = Sealed(ciphertext=bytes(row[0]), nonce=bytes(row[1]), key_version=row[2])
    return Credential.from_json(unseal(sealed))


def needs_refresh(credential: Credential, *, now: datetime | None = None) -> bool:
    """Whether this credential is too close to expiry to start a run with.

    Pure, and separated from the SQL on purpose: this is the decision worth
    testing, and it is testable with no database, no network and no clock
    monkeypatching. ``now`` is a parameter for the same reason.

    A credential with no recorded expiry is treated as fresh. That is the
    HubSpot private-app case -- a token that genuinely does not expire -- and
    guessing an expiry for it would refresh something that has no refresh token,
    turning a working connection into ``needs_reconnect``.
    """
    at = now or datetime.now(UTC)
    if credential.expires_at is None:
        return False
    return credential.expires_at - REFRESH_SKEW <= at


def access_token(
    conn: Any,
    tenant_id: str,
    source: str,
    *,
    refresher: Callable[[str], Credential] | None = None,
    now: datetime | None = None,
) -> str:
    """A usable access token, refreshing first if the stored one is close to expiry.

    Returns the token and nothing else. Callers get a string they can put in a
    header; whether that involved a network round trip is this module's problem.

    A connection with no refresh capability (a HubSpot private-app token, say)
    and an expired access token raises rather than returning the stale value. A
    stale token produces a 401 deep inside a sync, which reads as "the source is
    down" rather than "reconnect this".
    """
    credential = read_credential(conn, tenant_id, source, for_update=True)

    if not needs_refresh(credential, now=now):
        return credential.access_token

    if refresher is None or not credential.refresh_token:
        set_status(conn, tenant_id, source, "needs_reconnect")
        raise ConnectionError(
            f"{source} credential for tenant {tenant_id!r} expired and cannot be refreshed; "
            "the connection needs re-consent"
        )

    refreshed = refresher(credential.refresh_token)
    # Written back before use. Xero's rotation means the token we just spent is
    # already dead; losing the replacement here would cost the connection.
    write_credential(conn, tenant_id, source, refreshed)
    return refreshed.access_token
