"""Sealed credentials: what opens, what refuses, and what must never be guessed.

These tokens read a customer's email and accounting system. The failures worth
guarding are the quiet ones -- a key silently stretched into shape, a nonce
reused, a tampered ciphertext opening as an empty string -- because each produces
something that looks like a working connection.
"""

import base64
import os

import pytest
from cryptography.exceptions import InvalidTag

from vcdo.core.secrets import Sealed, SecretKeyMissing, current_key_version, seal, unseal

KEY_A = base64.b64encode(b"A" * 32).decode()
KEY_B = base64.b64encode(b"B" * 32).decode()


@pytest.fixture
def one_key(monkeypatch):
    monkeypatch.setenv("VCDO_SECRET_KEY", KEY_A)


# -- the round trip ----------------------------------------------------------


def test_a_sealed_credential_opens_to_what_went_in(one_key):
    sealed = seal("refresh-token-value")

    assert unseal(sealed) == "refresh-token-value"


def test_the_ciphertext_does_not_contain_the_plaintext(one_key):
    """The point of the exercise; a dump must not be readable."""
    sealed = seal("refresh-token-value")

    assert b"refresh-token-value" not in sealed.ciphertext


def test_sealing_the_same_value_twice_produces_different_ciphertext(one_key):
    """A reused nonce collapses both confidentiality and authentication in GCM."""
    first = seal("same-value")
    second = seal("same-value")

    assert first.nonce != second.nonce
    assert first.ciphertext != second.ciphertext
    assert unseal(first) == unseal(second) == "same-value"


# -- the key guard: it fires, and it stays quiet ------------------------------


def test_sealing_without_a_key_is_refused(monkeypatch):
    monkeypatch.delenv("VCDO_SECRET_KEY", raising=False)

    with pytest.raises(SecretKeyMissing, match="VCDO_SECRET_KEY"):
        seal("anything")


def test_sealing_with_a_key_is_not_refused(one_key):
    assert seal("anything").ciphertext


def test_a_short_key_is_refused_rather_than_stretched(monkeypatch):
    """Padding or hashing a short key yields something that works and is weak."""
    monkeypatch.setenv("VCDO_SECRET_KEY", base64.b64encode(b"tooshort").decode())

    with pytest.raises(SecretKeyMissing, match="32 bytes"):
        seal("anything")


def test_a_full_length_key_is_accepted(monkeypatch):
    monkeypatch.setenv("VCDO_SECRET_KEY", KEY_A)

    assert seal("anything").key_version == 1


def test_a_key_that_is_not_base64_is_refused(monkeypatch):
    monkeypatch.setenv("VCDO_SECRET_KEY", "not base64 at all!!")

    with pytest.raises(SecretKeyMissing, match="base64"):
        seal("anything")


# -- tampering must not open --------------------------------------------------


def test_a_tampered_ciphertext_refuses_to_open_rather_than_returning_nothing(one_key):
    """An empty string here would read downstream as a connection that exists and
    does not work -- the slowest failure to diagnose. Never guess.

    Asserting `InvalidTag` specifically, not a blind `Exception`: it proves the
    AEAD *authentication* rejected the bytes, rather than something incidental
    going wrong on the way.
    """
    sealed = seal("refresh-token-value")
    tampered = Sealed(
        ciphertext=sealed.ciphertext[:-1] + bytes([sealed.ciphertext[-1] ^ 0x01]),
        nonce=sealed.nonce,
        key_version=sealed.key_version,
    )

    with pytest.raises(InvalidTag):
        unseal(tampered)


def test_an_untampered_ciphertext_opens(one_key):
    sealed = seal("refresh-token-value")

    assert unseal(sealed) == "refresh-token-value"


def test_the_wrong_key_does_not_open_a_sealed_value(monkeypatch):
    monkeypatch.setenv("VCDO_SECRET_KEY", KEY_A)
    sealed = seal("refresh-token-value")

    monkeypatch.setenv("VCDO_SECRET_KEY", KEY_B)
    with pytest.raises(InvalidTag):
        unseal(sealed)


# -- rotation is additive ------------------------------------------------------


def test_new_values_seal_under_the_highest_key_version(monkeypatch):
    monkeypatch.setenv("VCDO_SECRET_KEY", f"1:{KEY_A},2:{KEY_B}")

    assert current_key_version() == 2
    assert seal("value").key_version == 2


def test_a_value_sealed_under_an_older_key_still_opens(monkeypatch):
    """Rotation must not require re-encrypting the table in one transaction."""
    monkeypatch.setenv("VCDO_SECRET_KEY", f"1:{KEY_A}")
    old = seal("older-token")

    monkeypatch.setenv("VCDO_SECRET_KEY", f"1:{KEY_A},2:{KEY_B}")

    assert unseal(old) == "older-token"
    assert seal("newer-token").key_version == 2


def test_dropping_a_key_that_rows_still_use_is_reported_not_guessed(monkeypatch):
    monkeypatch.setenv("VCDO_SECRET_KEY", f"1:{KEY_A}")
    old = seal("older-token")

    monkeypatch.setenv("VCDO_SECRET_KEY", f"2:{KEY_B}")
    with pytest.raises(SecretKeyMissing, match="rotated"):
        unseal(old)


def test_the_key_is_not_read_at_import_time(monkeypatch):
    """vcdo.core.config.load() is called by tests with an empty environment.

    A key resolved at import, or required by load(), would fail every one of
    those -- and would put a secret into a frozen dataclass that is logged and
    reprd freely.
    """
    monkeypatch.delenv("VCDO_SECRET_KEY", raising=False)

    from vcdo.core.config import load

    assert load({}).source_mode == "mock"
    assert "VCDO_SECRET_KEY" not in os.environ
