"""Money must be exact, and must refuse to guess.

These tests pin the two properties that actually protect a customer:
amounts survive arithmetic without drift, and an unreadable or incomparable
figure is reported as unknown rather than folded into a number someone will act
on.
"""

from decimal import Decimal

import pytest

from vcdo.core.money import SCALE, Money, Verdict, compare, parse_amount


def test_invoice_with_two_partial_payments_settles_exactly():
    """Handoff acceptance case: 100.00 USD invoice, payments of 40.00 and 60.00.

    The invoice stays 100.00 and the paid amount reaches exactly 100.00. Under
    float this is the classic 0.30000000000000004 family of defect, which shows
    up as a customer being chased for a fraction of a cent.
    """
    invoice = Money(Decimal("100.00"), "USD")
    paid = Money(Decimal("40.00"), "USD") + Money(Decimal("60.00"), "USD")

    assert invoice.amount == Decimal("100.00")
    assert paid.amount == Decimal("100.00")
    assert (invoice - paid).amount == Decimal("0.00")


def test_repeated_small_amounts_do_not_drift():
    total = Money(Decimal("0.00"), "SGD")
    for _ in range(10):
        total = total + Money(Decimal("0.10"), "SGD")
    assert total.amount == Decimal("1.00")


def test_currencies_are_never_silently_combined():
    with pytest.raises(ValueError) as excinfo:
        _ = Money(Decimal("100.00"), "SGD") + Money(Decimal("100.00"), "USD")
    assert "SGD" in str(excinfo.value) and "USD" in str(excinfo.value)


def test_same_number_in_two_currencies_is_unverified_not_mismatch():
    """4,000 SGD vs 4,000 USD is not agreement, and it is not disagreement either.

    Calling it a mismatch sends someone to investigate a discrepancy that has
    not been shown to exist.
    """
    verdict = compare(Money(Decimal("4000"), "SGD"), Money(Decimal("4000"), "USD"))
    assert verdict == Verdict.UNVERIFIED


def test_missing_evidence_never_passes():
    assert compare(None, Money(Decimal("10"), "SGD")) == Verdict.UNVERIFIED
    assert compare(Money(Decimal("10"), "SGD"), None) == Verdict.UNVERIFIED


def test_matching_and_differing_amounts_are_distinguished():
    a = Money(Decimal("100.00"), "SGD")
    assert compare(a, Money(Decimal("100.01"), "SGD")) == Verdict.OK  # within tolerance
    assert compare(a, Money(Decimal("140.00"), "SGD")) == Verdict.MISMATCH


def test_unreadable_amount_returns_none_rather_than_zero():
    """A parse failure that returns 0 is data loss wearing the costume of a fact."""
    for bad in ["", None, "n/a", "-", "TBC", "  "]:
        assert parse_amount(bad) is None


def test_european_notation_is_refused_rather_than_misread():
    """A "1.234,00" is 1234 in European notation and 1.234 read as US notation.

    Both readings are plausible and only the source knows which it meant, so a
    thousand-fold error is available to anyone who picks. We refuse.
    """
    assert parse_amount("1.234,00") is None


def test_float_input_is_rejected_at_the_boundary():
    """Accepting a float would launder precision loss that already happened."""
    with pytest.raises(TypeError):
        parse_amount(0.1 + 0.2)


def test_readable_amounts_parse_exactly():
    assert parse_amount("1,234.56") == Decimal("1234.56")
    assert parse_amount("$1,234.56") == Decimal("1234.56")
    assert parse_amount("-99.99") == Decimal("-99.99")
    assert parse_amount(1234) == Decimal("1234")
    assert parse_amount(Decimal("1234.5678")) == Decimal("1234.5678")


def test_rounding_is_half_up_not_bankers():
    """Auditors and customers expect .5 to round away from zero.

    Python's default is banker's rounding, which would turn 0.00005 into 0.0000
    here and produce figures a human cannot reproduce by hand.
    """
    assert Money(Decimal("0.00005"), "SGD").quantized().amount == Decimal("0.0001")
    assert Money(Decimal("0.00015"), "SGD").quantized().amount == Decimal("0.0002")


def test_storage_scale_keeps_four_places():
    """Rounding to cents before aggregation is how ledgers drift untraceably."""
    assert SCALE == Decimal("0.0001")
    assert Money(Decimal("1.23456"), "SGD").quantized().amount == Decimal("1.2346")


def test_currency_must_be_an_iso_code():
    with pytest.raises(ValueError):
        Money(Decimal("1"), "dollars")
    with pytest.raises(ValueError):
        Money(Decimal("1"), "sgd")


def test_amount_must_be_decimal():
    with pytest.raises(TypeError):
        Money(100.0, "SGD")  # type: ignore[arg-type]  # the point of the test
