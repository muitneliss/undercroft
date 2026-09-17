"""Xero curation: revenue rules and payment parentage.

The failures guarded against here are the plausible-looking ones — a supplier
bill counted as revenue, a credit-note payment attributed to an invoice, a
voided invoice quietly disappearing.
"""

from decimal import Decimal

from vcdo.curated.hubspot import Rejected
from vcdo.curated.xero import counts_as_revenue, to_invoice, to_payment


def raw(entity: str, record_id: str, payload: dict) -> dict:
    return {
        "source": "xero",
        "tenant_id": "tenant-test",
        "entity": entity,
        "source_record_id": record_id,
        "payload": payload,
    }


def inv(**over):
    base = {
        "InvoiceID": "inv-1",
        "Type": "ACCREC",
        "Status": "PAID",
        "CurrencyCode": "SGD",
        "Total": "100.00",
        "AmountPaid": "100.00",
        "AmountCredited": "0.00",
        "AmountDue": "0.00",
        "Contact": {"ContactID": "c-1", "Name": "Synthetic Alpha Pte Ltd"},
        "Date": "2026-01-05",
    }
    base.update(over)
    return base


# -- revenue rules -----------------------------------------------------------


def test_a_supplier_bill_is_never_our_revenue():
    """ACCPAY is money we owe. Counting it as revenue inflates the top line."""
    assert counts_as_revenue("ACCPAY", "PAID") is False
    assert counts_as_revenue("ACCREC", "PAID") is True


def test_voided_and_deleted_invoices_never_count_as_revenue():
    for status in ("VOIDED", "DELETED", "DRAFT"):
        assert counts_as_revenue("ACCREC", status) is False


def test_a_voided_invoice_is_retained_not_dropped():
    """A row that vanishes cannot be reconciled against."""
    result = to_invoice(raw("invoices", "inv-3", inv(Status="VOIDED", Total="999.99")))

    assert not isinstance(result, Rejected)
    assert result.status == "VOIDED"
    assert result.counts_as_revenue is False
    assert result.total == Decimal("999.99")


def test_amounts_stay_in_their_original_currency():
    """No pre-converted column: a converted figure with no visible rate cannot be audited."""
    result = to_invoice(raw("invoices", "inv-1", inv(CurrencyCode="USD", CurrencyRate="1.35")))

    assert result.currency == "USD"
    assert result.currency_rate == Decimal("1.35")
    assert result.total == Decimal("100.00")


def test_an_invoice_with_no_readable_currency_is_quarantined():
    """Guessing the tenant's base currency would produce a plausible wrong total."""
    result = to_invoice(raw("invoices", "inv-1", inv(CurrencyCode="")))

    assert isinstance(result, Rejected)
    assert result.reason_code == "missing_currency"


def test_an_unknown_invoice_type_is_quarantined():
    result = to_invoice(raw("invoices", "inv-1", inv(Type="ACCRECCREDIT")))

    assert isinstance(result, Rejected)
    assert result.reason_code == "unknown_invoice_type"


# -- payment parentage -------------------------------------------------------


def test_a_credit_note_payment_is_labelled_a_credit_note_not_an_invoice():
    """It arrives under the 'Invoice' key with InvoiceID holding the CreditNoteID.

    Trusting the key name attributes it to an invoice and silently inflates
    collections against that invoice.
    """
    payment = to_payment(
        raw(
            "payments",
            "pay-3",
            {
                "PaymentID": "pay-3",
                "PaymentType": "ARCREDITPAYMENT",
                "Amount": "450.00",
                "Invoice": {
                    "InvoiceID": "cn-1",
                    "Type": "ACCRECCREDIT",
                    "Contact": {"ContactID": "c-2"},
                },
            },
        )
    )

    assert payment.target_type == "credit_note"
    assert payment.target_source_id == "cn-1"
    assert payment.contact_source_id == "c-2"


def test_an_ordinary_invoice_payment_is_labelled_an_invoice():
    payment = to_payment(
        raw(
            "payments",
            "pay-1",
            {
                "PaymentID": "pay-1",
                "PaymentType": "ACCRECPAYMENT",
                "Amount": "40.00",
                "Invoice": {"InvoiceID": "inv-1", "Type": "ACCREC", "Contact": {"ContactID": "c-1"}},
            },
        )
    )

    assert payment.target_type == "invoice"
    assert payment.target_source_id == "inv-1"


def test_a_payment_with_no_identifiable_parent_is_unresolved_not_guessed():
    """Attributing it to an invoice would put money against a document at random."""
    payment = to_payment(raw("payments", "pay-9", {"PaymentID": "pay-9", "Amount": "10.00"}))

    assert payment.target_type == "unresolved"
    assert payment.target_source_id is None


def test_a_payment_carries_no_currency_of_its_own():
    """Xero denominates a payment in its parent's currency; asserting one here
    would be inventing a fact the payload does not contain."""
    payment = to_payment(
        raw("payments", "pay-1", {"PaymentID": "pay-1", "Amount": "40.00", "Invoice": {"InvoiceID": "inv-1"}})
    )

    assert payment.currency is None
    assert payment.amount == Decimal("40.00")
