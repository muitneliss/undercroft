"""Runtime configuration, resolved from the environment.

Two design rules.

**Secrets come from the environment, never from a tracked file.** Dokploy holds
them in its secret store and maps them in explicitly --- UI variables are *not*
automatically injected into containers, so every one a service needs is declared
in its compose `environment:` block or an `env_file`. A variable nobody mapped is
a silent empty string at runtime, which is the failure this module exists to make
loud.

**Mock mode is a first-class mode, not a test affordance.** Every source resolves
through ``SOURCE_MODE``: ``mock`` serves recorded fixtures, ``live`` calls the
real API. The seam is identical in both, so switching a source to live is a
configuration change --- not a code change. That also means the mock path is
exercised by the same code that will run in production, instead of rotting in a
test directory.

Mode is resolved per source, so Xero can go live while Gmail is still mocked.

**Credentials are not here, and used not to be either.** This module once
*required* ``VCDO_<SOURCE>_CREDENTIALS`` for every live source --- while
:class:`Config` had no field to hold the value and nothing ever read it again.
The effect was that going live passed validation and then failed in the source
constructor, and no gate test noticed because none constructed a live source.

They are gone rather than wired up, because one environment variable per source
cannot describe more than one customer and cannot be rewritten while the process
runs, and OAuth tokens rotate. Per-tenant credentials live in the registry
(:mod:`vcdo.core.connections`), sealed in Postgres. What a live source needs now
is a *connection*, and its absence is reported by the thing that needs it.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

__all__ = ["Config", "SourceMode", "MissingConfig", "load", "SOURCES"]

SourceMode = Literal["mock", "live"]

#: Every source the platform knows about. Used to validate per-source overrides,
#: so a typo in `VCDO_XERO_MODE` fails loudly instead of silently meaning "mock".
SOURCES = ("hubspot", "xero", "gmail", "drive")

_VALID_MODES = ("mock", "live")


class MissingConfig(Exception):
    """A required setting was absent or empty.

    Raised eagerly at startup rather than at first use. A pipeline that runs for
    ten minutes and then fails on a missing bucket name has already burned an
    API budget and written partial state.
    """


@dataclass(frozen=True, slots=True)
class Config:
    source_mode: SourceMode
    source_mode_overrides: dict[str, SourceMode]

    s3_endpoint: str
    s3_bucket_raw: str
    s3_bucket_quarantine: str
    s3_access_key: str
    s3_secret_key: str
    s3_region: str

    postgres_dsn: str

    fixtures_dir: str
    log_dir: str

    def mode_for(self, source: str) -> SourceMode:
        """Resolve the mode for one source.

        An unknown source name is an error, not a default. Defaulting would mean
        a typo'd override silently leaves a source in mock mode, and the symptom
        is a dashboard quietly showing fixture data in production.
        """
        if source not in SOURCES:
            raise MissingConfig(f"unknown source {source!r}; known sources are {', '.join(SOURCES)}")
        return self.source_mode_overrides.get(source, self.source_mode)

    def is_live(self, source: str) -> bool:
        return self.mode_for(source) == "live"

    @property
    def live_sources(self) -> tuple[str, ...]:
        return tuple(s for s in SOURCES if self.is_live(s))


def _require(env: dict[str, str], key: str, default: str | None = None) -> str:
    value = env.get(key, default if default is not None else "").strip()
    if not value:
        raise MissingConfig(
            f"{key} is required but unset or empty. In Dokploy, a variable set in the UI "
            "is not injected automatically -- map it explicitly in the compose "
            "`environment:` block or an `env_file`."
        )
    return value


def _mode(env: dict[str, str], key: str, default: str) -> SourceMode:
    raw = env.get(key, default).strip().lower() or default
    if raw not in _VALID_MODES:
        raise MissingConfig(f"{key}={raw!r} is not a valid mode; expected one of {', '.join(_VALID_MODES)}")
    return raw  # type: ignore[return-value]


def load(env: dict[str, str] | None = None) -> Config:
    """Build a :class:`Config` from ``env`` (defaults to the process environment).

    Defaults match deploy/compose/.env.example, including its off-the-well-known
    host ports. A default pointing at a port nothing listens on is a trap: it
    fails in a way that looks like the service is down rather than unconfigured.

    Takes ``env`` explicitly so tests configure by passing a dict rather than
    mutating global state, which otherwise leaks between tests in whatever order
    they happen to run.
    """
    e = dict(os.environ if env is None else env)

    mode = _mode(e, "VCDO_SOURCE_MODE", "mock")
    overrides: dict[str, SourceMode] = {}
    for source in SOURCES:
        key = f"VCDO_{source.upper()}_MODE"
        if key in e and e[key].strip():
            overrides[source] = _mode(e, key, mode)

    return Config(
        source_mode=mode,
        source_mode_overrides=overrides,
        s3_endpoint=_require(e, "VCDO_S3_ENDPOINT", "http://localhost:19000"),
        s3_bucket_raw=_require(e, "VCDO_S3_BUCKET_RAW", "vcc-raw"),
        s3_bucket_quarantine=_require(e, "VCDO_S3_BUCKET_QUARANTINE", "vcc-quarantine"),
        s3_access_key=_require(e, "VCDO_S3_ACCESS_KEY", "vcdo-local"),
        s3_secret_key=_require(e, "VCDO_S3_SECRET_KEY", "vcdo-local-secret"),
        s3_region=_require(e, "VCDO_S3_REGION", "us-east-1"),
        postgres_dsn=_require(e, "VCDO_POSTGRES_DSN", "postgresql://vcdo:vcdo-local@localhost:15432/vcdo"),
        fixtures_dir=_require(e, "VCDO_FIXTURES_DIR", "fixtures"),
        log_dir=_require(e, "VCDO_LOG_DIR", "data/logs"),
    )
