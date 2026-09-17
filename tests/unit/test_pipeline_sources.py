"""How the pipeline decides which sources to build, and what it refuses.

No gate test used to import vcdo.cli.pipeline at all. That is why nobody noticed
that `_sources` constructed every source with no credential and three hardcoded
fixture constants, while config.py separately demanded a
`VCDO_<SOURCE>_CREDENTIALS` value it then discarded. Going live passed
validation and crashed in a constructor, and `make verify` was green throughout.

These run offline: mock mode never touches a database, which is the property that
lets the gate run on a machine with no stack and no secrets.
"""

import pytest

from vcdo.cli import pipeline
from vcdo.core.config import load
from vcdo.sources.base import SourceError

FIXTURES = {"VCDO_FIXTURES_DIR": "fixtures"}


def test_mock_mode_builds_every_source_without_a_database():
    cfg = load(FIXTURES)

    built = pipeline._sources(cfg)

    assert [s.name for s in built] == ["hubspot", "xero", "gmail", "drive"]


def test_mock_sources_carry_the_fixture_tenant_not_a_registry_lookup():
    cfg = load(FIXTURES)

    built = {s.name: s for s in pipeline._sources(cfg)}

    assert built["hubspot"].tenant_id == pipeline.FIXTURE_TENANT
    assert built["gmail"].mailbox == pipeline.FIXTURE_MAILBOX


def test_a_live_source_without_a_database_connection_is_refused():
    """The registry is where a live credential comes from; there is no fallback.

    A source built without one does not read less data -- it reads none, and a
    run that lands zero rows looks exactly like a quiet month.
    """
    cfg = load(FIXTURES | {"VCDO_XERO_MODE": "live"})

    with pytest.raises(SourceError, match="connection registry"):
        pipeline._sources(cfg)


def test_mock_mode_is_not_refused_for_the_same_reason():
    """The guard must not fire when nothing is live."""
    cfg = load(FIXTURES)

    assert pipeline._sources(cfg, None)


class _NoConnections:
    """A registry with no rows. Real behaviour, in memory: the query returns None."""

    def execute(self, *_args, **_kwargs):
        return self

    def fetchone(self):
        return None

    def fetchall(self):
        return []


def test_a_live_source_with_no_connection_row_names_the_tenant_it_looked_for():
    cfg = load(FIXTURES | {"VCDO_XERO_MODE": "live"})

    with pytest.raises(SourceError, match="has no connection"):
        pipeline._sources(cfg, _NoConnections(), "CASE-001")


def test_the_other_sources_stay_mocked_when_one_goes_live():
    """Onboarding is one source at a time; the rest must keep serving fixtures."""
    cfg = load(FIXTURES | {"VCDO_XERO_MODE": "live"})

    with pytest.raises(SourceError):
        pipeline._sources(cfg, _NoConnections(), "CASE-001")

    # ...and with nothing live, all four are the mock ones.
    assert all(s.mode == "mock" for s in pipeline._sources(load(FIXTURES)))
