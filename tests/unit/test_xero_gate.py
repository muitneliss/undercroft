"""The gate must block wrong financial data, and must not block sound data.

Both directions matter. A gate that never blocks is not known to work; a gate
that blocks sound data gets overridden, and after the second override nobody
reads it.
"""

from vcdo.curated.xero_gate import TOLERANCE, adjudicate, payment_parent


def invoice(**over):
    base = {
        "InvoiceID": "inv-1",
        "Status": "PAID",
        "Total": "100.00",
        "AmountPaid": "100.00",
        "AmountCredited": "0.00",
        "AmountDue": "0.00",
        "Payments": [{"Amount": "100.00"}],
    }
    base.update(over)
    return base


def test_a_reconciling_invoice_passes():
    """Handoff case: 100.00 invoice, partial payments of 40.00 and 60.00."""
    result = adjudicate([invoice(Payments=[{"Amount": "40.00"}, {"Amount": "60.00"}])])

    assert result.passed
    assert result.findings == []


def test_an_invoice_that_does_not_reconcile_blocks_publish():
    """Total != paid + credited + due means something was not fetched."""
    result = adjudicate([invoice(Total="120.00")])

    assert not result.passed
    assert result.blocking[0].code == "invoice_does_not_reconcile"


def test_missing_payment_references_block_publish():
    """An invoice fetched without its payments under-reports collections while looking complete."""
    result = adjudicate([invoice(Payments=[{"Amount": "40.00"}])])

    assert not result.passed
    assert result.blocking[0].code == "payment_references_incomplete"


def test_a_credited_invoice_is_flagged_for_review_not_blocked():
    """AmountCredited may include pre/overpayments; guessing turns money held into money collected."""
    result = adjudicate(
        [invoice(Total="100.00", AmountPaid="0.00", AmountCredited="100.00", AmountDue="0.00", Payments=[])]
    )

    assert result.passed  # review, not block
    assert result.review[0].code == "review_credit_allocation"


def test_voided_invoices_are_not_subject_to_arithmetic():
    """A voided invoice is evidence of a cancellation, not a reconciliation target."""
    result = adjudicate([invoice(Status="VOIDED", Total="999.99", AmountPaid="0.00", Payments=[])])

    assert result.passed
    assert result.findings == []


def test_an_unreadable_amount_blocks_rather_than_being_treated_as_zero():
    """Zero would silently satisfy the very check this exists to enforce."""
    result = adjudicate([invoice(AmountCredited="n/a")])

    assert not result.passed
    assert result.blocking[0].code == "unreadable_amount"


def test_rounding_within_a_cent_is_tolerated():
    """A currency-rate rounding step must not block a sound ledger."""
    result = adjudicate([invoice(AmountDue=str(TOLERANCE))])

    assert result.passed


def test_a_shortfall_larger_than_tolerance_is_caught():
    result = adjudicate([invoice(AmountDue="0.02", Total="100.02")])

    assert result.passed  # 100.02 = 100.00 + 0 + 0.02 reconciles exactly
    result = adjudicate([invoice(Total="100.50")])
    assert not result.passed


# -- the credit-note parent quirk --------------------------------------------


def test_a_credit_note_payment_is_found_despite_arriving_under_the_invoice_key():
    """Measured Xero behaviour: ARCREDITPAYMENT arrives under 'Invoice',
    and the InvoiceID there carries the CreditNoteID -- not any invoice id.

    Resolving by key name finds nothing and fails a sound payment, which is
    fail-closed catching the wrong thing.
    """
    payment = {
        "PaymentID": "pay-1",
        "PaymentType": "ARCREDITPAYMENT",
        "Invoice": {"InvoiceID": "cn-1", "Type": "ACCRECCREDIT"},
    }

    assert payment_parent(payment, "cn-1") is not None


def test_the_check_is_not_relaxed_a_wrong_id_is_still_rejected():
    """Fixing the lookup must not turn the check off."""
    payment = {"PaymentID": "pay-1", "Invoice": {"InvoiceID": "some-other-doc"}}

    assert payment_parent(payment, "cn-1") is None


def test_an_ordinary_invoice_payment_still_resolves():
    payment = {"PaymentID": "pay-1", "Invoice": {"InvoiceID": "inv-1", "Type": "ACCREC"}}

    assert payment_parent(payment, "inv-1") is not None
