"""Control plane contracts that must hold without a database or a network.

Three families, each guarding a failure that is invisible until it is expensive:

**Money.** JavaScript's `number` is a float, so a `Decimal` that reaches the
browser as JSON `number` is silently rounded and then displayed as fact. A custom
encoder does not prevent it -- FastAPI's `jsonable_encoder` and Pydantic's
`model_dump(mode="json")` both convert before any encoder of ours runs -- so the
guarantee has to be "no response model contains that type", and this is where
that is checked.

**The OAuth `state`.** It is the only thing standing between a captured callback
and an account being attached to the wrong customer.

**The provider parameters that are easy to omit and only fail later.**
`prompt=consent` above all: without it a returning Google user yields no refresh
token, everything works for an hour, and the connection then dies with no
obvious cause.
"""

import base64
import hashlib
from decimal import Decimal

import pytest

from vcdo.api import models
from vcdo.api.security import OAuthState, StateError, new_pkce, read_state, sign_state

SECRET = "test-session-secret"


# -- money never crosses as a number -----------------------------------------

RESPONSE_MODELS = [
    models.Money,
    models.TenantOut,
    models.UserOut,
    models.ConnectionOut,
    models.LakeObjectOut,
]


@pytest.mark.parametrize("model", RESPONSE_MODELS, ids=lambda m: m.__name__)
def test_no_response_model_sends_a_bare_number_where_money_could_go(model):
    offenders = models.assert_no_bare_numbers(model)

    assert offenders == [], f"{model.__name__} would send {offenders} as float"


def test_the_guard_fires_on_a_model_that_does_expose_a_float():
    """A guard with only a passing case is indistinguishable from one that never
    fires."""
    from pydantic import BaseModel

    class Regression(BaseModel):
        total: Decimal

    assert models.assert_no_bare_numbers(Regression) == ["total"]


def test_money_keeps_every_digit_it_was_given():
    amount = Decimal("8500.0001")

    assert models.Money.of(amount, "SGD").amount == "8500.0001"


def test_an_absent_amount_is_none_and_never_zero():
    """SQL sum() over no rows is NULL. Rendering that as 0 turns "we have no
    data" into "the figure is nought", which is a fact nobody established."""
    assert models.Money.of(None, "SGD") is None


def test_an_amount_always_carries_its_currency():
    """Two amounts in different currencies are not comparable, so there is no
    ambient default to fall back on."""
    with pytest.raises(TypeError):
        models.Money.of(Decimal("1.00"))  # type: ignore[call-arg]


# -- the three-valued verdict stays three-valued -----------------------------


def test_the_verdict_type_admits_unverified_as_its_own_outcome():
    from typing import get_args

    assert set(get_args(models.Verdict)) == {"ok", "mismatch", "unverified"}


# -- the OAuth state ----------------------------------------------------------


def state_for(session_id="sess-1", tenant="CASE-001:xero", provider="xero"):
    return OAuthState(
        provider=provider,
        tenant_id=tenant,
        session_id=session_id,
        verifier="v" * 43,
        next_path="/tenants/CASE-001",
    )


def test_a_state_we_issued_verifies():
    token = sign_state(SECRET, state_for())

    verified = read_state(SECRET, token, session_id="sess-1", provider="xero")

    assert verified.tenant_id == "CASE-001:xero"


def test_a_tampered_state_is_refused():
    token = sign_state(SECRET, state_for())

    with pytest.raises(StateError):
        read_state(SECRET, token + "x", session_id="sess-1", provider="xero")


def test_a_state_signed_with_another_secret_is_refused():
    token = sign_state("someone-elses-secret", state_for())

    with pytest.raises(StateError):
        read_state(SECRET, token, session_id="sess-1", provider="xero")


def test_a_state_issued_for_another_session_is_refused():
    """Without this, an unexpired state captured from one user is a bearer token
    for attaching an account."""
    token = sign_state(SECRET, state_for(session_id="sess-1"))

    with pytest.raises(StateError, match="different session"):
        read_state(SECRET, token, session_id="sess-2", provider="xero")


def test_a_state_issued_for_another_provider_is_refused():
    token = sign_state(SECRET, state_for(provider="xero"))

    with pytest.raises(StateError, match="different provider"):
        read_state(SECRET, token, session_id="sess-1", provider="google")


def test_the_state_carries_the_tenant_the_flow_started_for():
    """Not the tenant the browser is looking at when it returns."""
    token = sign_state(SECRET, state_for(tenant="CASE-AAA:gmail"))

    assert read_state(SECRET, token, session_id="sess-1", provider="xero").tenant_id == "CASE-AAA:gmail"


# -- PKCE ---------------------------------------------------------------------


def test_the_pkce_challenge_is_the_s256_of_the_verifier():
    """The `plain` method is also spec-legal and worthless: it sends the secret
    as the challenge. Only S256 is generated."""
    verifier, challenge = new_pkce()

    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    assert challenge == expected


def test_each_pkce_pair_is_fresh():
    assert new_pkce()[0] != new_pkce()[0]


# -- provider parameters that fail late --------------------------------------


@pytest.fixture
def oauth_env(monkeypatch):
    monkeypatch.setenv("VCDO_API_BASE_URL", "https://vcdo.example")
    monkeypatch.setenv("VCDO_SESSION_SECRET", SECRET)
    monkeypatch.setenv("VCDO_TRIGGER_TOKEN", "t")
    for provider in ("GOOGLE", "XERO", "HUBSPOT"):
        monkeypatch.setenv(f"VCDO_{provider}_CLIENT_ID", "id")
        monkeypatch.setenv(f"VCDO_{provider}_CLIENT_SECRET", "secret")


def test_google_always_forces_the_consent_screen(oauth_env):
    """THE bug this integration ships with otherwise. Google returns a refresh
    token only on the FIRST consent for a client/user pair; a returning user gets
    an access token and none, and the connection dies an hour later."""
    from vcdo.api.oauth.google import GMAIL_SCOPES, GoogleProvider

    url = GoogleProvider().authorize_url(state="s", challenge="c", scopes=GMAIL_SCOPES)

    assert "prompt=consent" in url
    assert "access_type=offline" in url


def test_google_asks_only_for_the_source_being_connected(oauth_env):
    """Connecting Drive must not request the ability to read a customer's email."""
    from vcdo.api.oauth.google import DRIVE_SCOPES, GoogleProvider

    url = GoogleProvider().authorize_url(state="s", challenge="c", scopes=DRIVE_SCOPES)

    assert "drive.readonly" in url
    assert "gmail.readonly" not in url


def test_the_narrow_drive_scope_is_not_a_restricted_one(oauth_env):
    """drive.file needs no Google verification or CASA assessment; it is the
    cheaper route to production if that timeline bites. Recorded here so the
    alternative is not forgotten."""
    from vcdo.api.oauth.google import DRIVE_SCOPES, DRIVE_SCOPES_NARROW

    assert DRIVE_SCOPES_NARROW == ("https://www.googleapis.com/auth/drive.file",)
    assert DRIVE_SCOPES != DRIVE_SCOPES_NARROW


def test_a_partial_grant_is_read_from_what_was_returned(oauth_env):
    """One screen offers both scopes and the user may approve one."""
    from vcdo.api.oauth.google import granted_scopes

    assert granted_scopes("openid https://www.googleapis.com/auth/gmail.readonly") == (
        "openid",
        "https://www.googleapis.com/auth/gmail.readonly",
    )
    assert granted_scopes("") == ()


def test_xero_lists_organisations_from_a_different_host_than_accounting_calls():
    """https://api.xero.com/connections, NOT under .../api.xro/2.0. Building it by
    appending to the accounting base url 404s."""
    from vcdo.api.oauth.xero import CONNECTIONS_URL

    assert CONNECTIONS_URL == "https://api.xero.com/connections"
    assert "api.xro" not in CONNECTIONS_URL


def test_xero_requests_offline_access_or_there_is_no_refresh_token():
    """Access tokens last 30 minutes, which is shorter than a real sync."""
    from vcdo.api.oauth.xero import XERO_SCOPES

    assert "offline_access" in XERO_SCOPES


def test_hubspot_requests_the_scope_its_associations_route_needs():
    """Associations are the deal->company edge from a different route, and the
    exchange fails with MISSING_SCOPES if companies.read is omitted."""
    from vcdo.api.oauth.hubspot import HUBSPOT_SCOPES

    assert "crm.objects.companies.read" in HUBSPOT_SCOPES
    assert "crm.objects.deals.read" in HUBSPOT_SCOPES
