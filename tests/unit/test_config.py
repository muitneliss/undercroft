"""Configuration must fail loudly, and must never quietly serve fixtures in production.

The expensive failure this guards against is a source silently staying in mock
mode because someone typo'd an override, producing a dashboard full of synthetic
numbers that looks entirely plausible.
"""

import pytest

from vcdo.core.config import MissingConfig, load


def test_defaults_to_mock_so_the_platform_runs_without_any_credential():
    cfg = load({})

    assert cfg.source_mode == "mock"
    assert cfg.live_sources == ()
    assert not cfg.is_live("hubspot")


def test_a_single_source_can_go_live_while_the_rest_stay_mocked():
    """This is how sources are onboarded: one connection at a time, no code change."""
    cfg = load({"VCDO_XERO_MODE": "live"})

    assert cfg.is_live("xero")
    assert not cfg.is_live("gmail")
    assert cfg.live_sources == ("xero",)


def test_global_live_mode_applies_to_every_source():
    assert load({"VCDO_SOURCE_MODE": "live"}).live_sources == ("hubspot", "xero", "gmail", "drive")


def test_a_source_can_be_held_back_when_the_default_is_live():
    cfg = load({"VCDO_SOURCE_MODE": "live", "VCDO_GMAIL_MODE": "mock"})

    assert not cfg.is_live("gmail")
    assert cfg.is_live("hubspot")


def test_going_live_no_longer_demands_a_credential_env_var():
    """Config used to `_require` VCDO_<SOURCE>_CREDENTIALS while having nowhere to
    put the value and nothing that read it -- so going live passed validation and
    then crashed in the source constructor.

    Credentials are per tenant now and live in the registry, so the check that
    matters is "is there a usable connection", and it belongs to the code that
    needs one. See test_pipeline_sources.py.
    """
    cfg = load({"VCDO_XERO_MODE": "live"})  # must not raise

    assert cfg.live_sources == ("xero",)


def test_mock_mode_needs_no_credentials():
    load({"VCDO_SOURCE_MODE": "mock"})  # must not raise


def test_an_unrecognised_mode_is_refused_rather_than_treated_as_mock():
    with pytest.raises(MissingConfig, match="not a valid mode"):
        load({"VCDO_SOURCE_MODE": "production"})


def test_an_unknown_source_name_is_an_error():
    """A typo must not resolve to a default, or it silently means 'mock'."""
    cfg = load({})
    with pytest.raises(MissingConfig, match="unknown source"):
        cfg.mode_for("hubpsot")


def test_empty_required_setting_is_refused_with_the_dokploy_hint():
    """Dokploy UI variables are not auto-injected; the error has to say so.

    An operator who set the variable in the dashboard and still sees it empty
    will otherwise conclude the platform is broken rather than unmapped.
    """
    with pytest.raises(MissingConfig, match="map it explicitly"):
        load({"VCDO_S3_BUCKET_RAW": "   "})
