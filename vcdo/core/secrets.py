"""Sealing per-tenant credentials at rest.

The control plane holds one OAuth refresh token per customer per source. Those
tokens read a company's email and its accounting system, so they do not sit in
the database in the clear -- a Postgres dump, a misdirected backup or an
over-broad ``GRANT`` would otherwise hand over every customer's data at once.

**Why here and not the lake.** A token rotates. ``.claude/rules/raw-lake.md``
forbids overwriting an object in place, which is exactly what rotation is, so
the lake cannot hold mutable credential state without giving up the property
that makes it an archive. Postgres is the projection store; this is a
projection.

**Why not a secrets manager.** Vault or Infisical would isolate this better, and
would also be another service to run, secure and back up on a host with 11 GiB
free and no swap -- for one table. Recorded in ADR 0005 rather than left as an
implied preference.

**The key is resolved lazily, never at import and never through**
:func:`vcdo.core.config.load`. ``load()`` is called by tests with an empty
environment; making the key a required setting there would fail every one of
them, and making it optional there would put a secret in a frozen dataclass that
is logged and reprd freely. So it is read at the moment it is used.

**Rotation is additive.** Each row records the ``key_version`` that sealed it.
A new key is added under a new version and becomes the one used for writes;
existing rows stay readable until something rewrites them. Nothing has to
re-encrypt the table in a single transaction, which is the migration everybody
puts off and then does badly.
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass

__all__ = ["Sealed", "SecretKeyMissing", "seal", "unseal", "current_key_version"]

#: Environment variable holding the base64 master key(s).
#:
#: One key is ``<base64>``. Several are ``<version>:<base64>`` separated by
#: commas, highest version wins for new writes::
#:
#:     VCDO_SECRET_KEY=1:aGVsbG8...,2:d29ybGQ...
_KEY_ENV = "VCDO_SECRET_KEY"

#: AES-256. Not negotiable by configuration: a key length that can be shortened
#: by an environment variable is a key length that will be, on the machine where
#: someone was in a hurry.
_KEY_BYTES = 32

#: 96 bits, the size AES-GCM is specified for. A different length is accepted by
#: the library and weakens the construction, so it is fixed here.
_NONCE_BYTES = 12


class SecretKeyMissing(Exception):
    """No usable master key was configured.

    Raised eagerly, like :class:`vcdo.core.config.MissingConfig`. A control plane
    that starts without its key would accept a customer's OAuth consent, fail to
    store the token, and have to ask them to do it again -- after sending them
    through Google.
    """


@dataclass(frozen=True, slots=True)
class Sealed:
    """One sealed value, exactly as the three columns store it."""

    ciphertext: bytes
    nonce: bytes
    key_version: int


def _keys() -> dict[int, bytes]:
    raw = os.environ.get(_KEY_ENV, "").strip()
    if not raw:
        raise SecretKeyMissing(
            f"{_KEY_ENV} is required to seal or open a credential. Generate one with "
            '`python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"` '
            "and map it explicitly in the compose `environment:` block -- a variable set in "
            "the Dokploy UI is not injected into a container by itself."
        )

    keys: dict[int, bytes] = {}
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        version, _, material = part.rpartition(":")
        try:
            key = base64.b64decode(material, validate=True)
        except Exception as exc:
            raise SecretKeyMissing(f"{_KEY_ENV} entry is not valid base64") from exc
        if len(key) != _KEY_BYTES:
            # Length is checked rather than padded or hashed into shape. Silently
            # stretching a short key produces something that encrypts and
            # decrypts perfectly while having far less entropy than it claims.
            raise SecretKeyMissing(
                f"{_KEY_ENV} must decode to {_KEY_BYTES} bytes for AES-256; got {len(key)}"
            )
        try:
            keys[int(version) if version else 1] = key
        except ValueError as exc:
            raise SecretKeyMissing(f"{_KEY_ENV} version {version!r} is not an integer") from exc

    if not keys:
        raise SecretKeyMissing(f"{_KEY_ENV} is set but contains no key")
    return keys


def current_key_version() -> int:
    """The version new values are sealed under: the highest configured."""
    return max(_keys())


def seal(plaintext: str, *, key_version: int | None = None) -> Sealed:
    """Seal ``plaintext`` with AES-256-GCM under a fresh random nonce.

    A nonce is never reused: GCM's confidentiality *and* its authentication both
    collapse if one is, so it is generated per call from ``os.urandom`` rather
    than derived from anything about the row.
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    keys = _keys()
    version = current_key_version() if key_version is None else key_version
    if version not in keys:
        raise SecretKeyMissing(f"{_KEY_ENV} has no key for version {version}")

    nonce = os.urandom(_NONCE_BYTES)
    ciphertext = AESGCM(keys[version]).encrypt(nonce, plaintext.encode(), None)
    return Sealed(ciphertext=ciphertext, nonce=nonce, key_version=version)


def unseal(sealed: Sealed) -> str:
    """Open a sealed value.

    Any failure -- wrong key, truncated ciphertext, tampered bytes -- surfaces as
    the library's own exception rather than being caught and turned into ``None``
    or ``""``. A credential that silently opens as empty would be presented as a
    connection that exists and does not work, which is the failure that takes
    longest to diagnose. `.claude/rules/data-integrity.md`: never guess.
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    keys = _keys()
    if sealed.key_version not in keys:
        raise SecretKeyMissing(
            f"{_KEY_ENV} has no key for version {sealed.key_version}; a key was rotated "
            "out while rows sealed under it still exist"
        )
    return AESGCM(keys[sealed.key_version]).decrypt(sealed.nonce, sealed.ciphertext, None).decode()
