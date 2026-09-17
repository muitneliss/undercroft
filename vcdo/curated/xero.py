"""Transform raw Xero records into curated invoices and payments.

Pure functions, same contract as the HubSpot transforms: never guess, quarantine
what cannot be read, and keep money exact and currency-bearing.

Two Xero-specific rules live here:

**Revenue is ACCREC only, and never VOIDED or DELETED.** Both facts are decided
once, in ``counts_as_revenue``, rather than in every query that wants a revenue
figure. A dashboard author who forgets one of them produces a number that is
wrong in a direction nobody notices.

**A payment's parent is resolved by id, not by response key.** See
:func:`vcdo.curated.xero_gate.payment_parent`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from vcdo.core.money import parse_amount
from vcdo.curated.hubspot import Rejected

__all__ = ["CuratedInvoice", "CuratedPayment", "to_invoice", "to_payment", "counts_as_revenue"]

#: Statuses that never represent revenue, but whose rows are retained as evidence
#: that something was cancelled.
_NON_REVENUE_STATUSES = frozenset({"VOIDED", "DELETED", "DRAFT"})

_PARENT_TYPE = {
    "InvoiceID": "invoice",
    "CreditNoteID": "credit_note",
    "PrepaymentID": "prepayment",
    "OverpaymentID": "overpayment",
}


@dataclass(frozen=True, slots=True)
class CuratedInvoice:
    source: str
    tenant_id: str
    source_record_id: str
    contact_source_id: str | None
    contact_name: str | None
    invoice_number: str | None
    invoice_type: str
    status: str
    currency: str
    currency_rate: Decimal | None
    total: Decimal | None
    amount_paid: Decimal | None
    amount_credited: Decimal | None
    amount_due: Decimal | None
    counts_as_revenue: bool
    issued_on: date | None
    due_on: date | None
    source_updated_at: datetime | None


@dataclass(frozen=True, slots=True)
class CuratedPayment:
    source: str
    tenant_id: str
    source_record_id: str
    payment_type: str | None
    status: str | None
    target_type: str
    target_source_id: str | None
    contact_source_id: str | None
    currency_rate: Decimal | None
    amount: Decimal | None
    currency: str | None
    paid_on: date | None
    source_updated_at: datetime | None


def counts_as_revenue(invoice_type: str, status: str) -> bool:
    """Decided once, here.

    ACCREC is a customer invoice; ACCPAY is a supplier bill and is never our
    revenue. VOIDED/DELETED/DRAFT never count, but their rows are kept.
    """
    return invoice_type == "ACCREC" and status not in _NON_REVENUE_STATUSES


def to_invoice(raw: dict) -> CuratedInvoice | Rejected:
    payload = raw.get("payload") or {}
    record_id = raw.get("source_record_id") or ""
    if not record_id:
        return Rejected("missing_source_id", "invoice has no InvoiceID and cannot be keyed")

    invoice_type = str(payload.get("Type") or "")
    if invoice_type not in ("ACCREC", "ACCPAY"):
        return Rejected("unknown_invoice_type", f"Type {invoice_type!r} is neither ACCREC nor ACCPAY")

    currency = str(payload.get("CurrencyCode") or "").upper()
    if len(currency) != 3:
        # An invoice with no readable currency cannot be summed or compared, and
        # guessing the tenant's base currency would produce a plausible wrong
        # total. Quarantine it instead.
        raw_currency = payload.get("CurrencyCode")
        return Rejected("missing_currency", f"CurrencyCode {raw_currency!r} is not an ISO code")

    status = str(payload.get("Status") or "")
    contact = payload.get("Contact") or {}

    return CuratedInvoice(
        source=raw.get("source", "xero"),
        tenant_id=raw.get("tenant_id", ""),
        source_record_id=record_id,
        contact_source_id=_clean(contact.get("ContactID")),
        contact_name=_clean(contact.get("Name")),
        invoice_number=_clean(payload.get("InvoiceNumber")),
        invoice_type=invoice_type,
        status=status,
        currency=currency,
        currency_rate=parse_amount(_str(payload.get("CurrencyRate"))),
        total=parse_amount(_str(payload.get("Total"))),
        amount_paid=parse_amount(_str(payload.get("AmountPaid"))),
        amount_credited=parse_amount(_str(payload.get("AmountCredited"))),
        amount_due=parse_amount(_str(payload.get("AmountDue"))),
        counts_as_revenue=counts_as_revenue(invoice_type, status),
        issued_on=_date(payload.get("Date")),
        due_on=_date(payload.get("DueDate")),
        source_updated_at=_ts(payload.get("UpdatedDateUTC")),
    )


def to_payment(raw: dict) -> CuratedPayment | Rejected:
    payload = raw.get("payload") or {}
    record_id = raw.get("source_record_id") or ""
    if not record_id:
        return Rejected("missing_source_id", "payment has no PaymentID and cannot be keyed")

    target_type, target_id, contact_id = _resolve_target(payload)

    amount = parse_amount(_str(payload.get("Amount")))

    return CuratedPayment(
        source=raw.get("source", "xero"),
        tenant_id=raw.get("tenant_id", ""),
        source_record_id=record_id,
        payment_type=_clean(payload.get("PaymentType")),
        status=_clean(payload.get("Status")),
        target_type=target_type,
        target_source_id=target_id,
        contact_source_id=contact_id,
        currency_rate=parse_amount(_str(payload.get("CurrencyRate"))),
        amount=amount,
        # Xero payments carry no currency of their own; they are denominated in
        # the parent document's currency. Resolved at load time from the invoice,
        # so it is never asserted here from nothing.
        currency=None,
        paid_on=_date(payload.get("Date")),
        source_updated_at=_ts(payload.get("UpdatedDateUTC")),
    )


def _resolve_target(payload: dict) -> tuple[str, str | None, str | None]:
    """Work out what a payment is actually against.

    The parent is identified by which ID FIELD is populated, not by which key it
    arrived under: a credit note's payment arrives under ``Invoice`` with
    ``InvoiceID`` holding the CreditNoteID. Trusting the key name mislabels every
    credit-note payment as an invoice payment, which silently inflates
    collections against invoices.

    The honest tell is ``PaymentType``: ``ARCREDITPAYMENT`` means credit note
    regardless of where it was nested.
    """
    payment_type = str(payload.get("PaymentType") or "").upper()
    for key in ("Invoice", "CreditNote", "Prepayment", "Overpayment"):
        parent = payload.get(key)
        if not isinstance(parent, dict):
            continue
        contact = (parent.get("Contact") or {}).get("ContactID")
        doc_type = str(parent.get("Type") or "").upper()

        for id_field, kind in _PARENT_TYPE.items():
            value = parent.get(id_field)
            if not value:
                continue
            # The document's own Type, and the payment type, both override the
            # key the parent was nested under.
            if payment_type == "ARCREDITPAYMENT" or doc_type == "ACCRECCREDIT":
                kind = "credit_note"
            return kind, str(value), _clean(contact)

    # Unresolved is a real state, not an error to paper over. A payment whose
    # parent we cannot identify must not be silently attributed to an invoice.
    return "unresolved", None, None


def resolve_payment_currency(payment: CuratedPayment, invoice_currency: str | None) -> CuratedPayment:
    """Attach the parent invoice's currency. Left None when the parent is unknown.

    The schema permits a NULL currency only when the amount is also NULL, so an
    unresolved payment is visibly incomplete rather than quietly denominated in
    whatever the reader assumes.
    """
    from dataclasses import replace

    return replace(payment, currency=invoice_currency)


def _clean(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _str(value: object) -> str:
    return "" if value is None else str(value)


def _ts(value: object) -> datetime | None:
    text = _clean(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _date(value: object) -> date | None:
    text = _clean(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None
