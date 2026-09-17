"""The Xero reconciliation gate.

**A pure function over records already in hand.** No network, no database, no
clock. That is what makes it re-runnable against the frozen lake whenever a rule
changes, without spending a single API call -- the legacy system measured that
replay at 6 clients in 1.4 seconds against roughly 2.5 minutes for a real fetch.

It is also why a live run and a replay must call *this same function*. Two copies
of the judgement would let a replay disagree with the run that produced the data,
which is the one thing that makes replay worthless.

The gate **blocks publish**. It does not warn. Accounting data that does not
reconcile is not a degraded dashboard, it is a wrong one, and a wrong financial
figure is acted on precisely because it looks plausible.

Three checks, each from a measured failure in the legacy system:

1. **Invoice arithmetic.** ``Total == AmountPaid + AmountCredited + AmountDue``.
   If that does not hold, something is missing from what we fetched.
2. **Payment identity.** Every payment an invoice references must be present and
   sum to ``AmountPaid``. Fetching invoices without their payments produces a
   ledger that looks complete and under-reports collections.
3. **Payment parentage by ID, never by key name.** See :func:`payment_parent`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from vcdo.core.money import parse_amount

__all__ = ["GateResult", "Finding", "adjudicate", "payment_parent", "TOLERANCE"]

#: Rounding tolerance. One cent: enough to absorb a currency-rate rounding step,
#: far too small to hide a missing payment.
TOLERANCE = Decimal("0.01")

#: Statuses that represent real money. VOIDED and DELETED invoices are retained
#: in curated (they are evidence that something was cancelled) but are never
#: counted as revenue and are not subject to arithmetic checks.
LIVE_STATUSES = frozenset({"AUTHORISED", "PAID"})


@dataclass(frozen=True, slots=True)
class Finding:
    severity: str  # "block" or "review"
    code: str
    document_id: str
    detail: str


@dataclass(frozen=True, slots=True)
class GateResult:
    findings: list[Finding] = field(default_factory=list)

    @property
    def blocking(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "block"]

    @property
    def review(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "review"]

    @property
    def passed(self) -> bool:
        return not self.blocking

    def summary(self) -> str:
        if self.passed and not self.review:
            return "gate passed"
        parts = []
        if self.blocking:
            parts.append(f"{len(self.blocking)} blocking")
        if self.review:
            parts.append(f"{len(self.review)} for review")
        return "gate: " + ", ".join(parts)


def _amount(record: dict, field_name: str) -> Decimal:
    """Read a money field. Absent is zero; *unreadable* is not.

    An absent AmountCredited genuinely means nothing was credited. An unreadable
    one means we do not know, and treating that as zero would silently satisfy
    the arithmetic check it exists to enforce.
    """
    raw = record.get(field_name)
    if raw is None:
        return Decimal(0)
    value = parse_amount(str(raw))
    if value is None:
        raise ValueError(f"{field_name}={raw!r} is not a readable amount")
    return value


def adjudicate(invoices: list[dict]) -> GateResult:
    """Judge invoices already fetched. Pure; safe to re-run over frozen raw."""
    findings: list[Finding] = []

    for inv in invoices:
        doc_id = str(inv.get("InvoiceID") or inv.get("CreditNoteID") or "<no id>")
        status = str(inv.get("Status") or "")

        if status not in LIVE_STATUSES:
            continue

        try:
            total = _amount(inv, "Total")
            paid = _amount(inv, "AmountPaid")
            credited = _amount(inv, "AmountCredited")
            due = _amount(inv, "AmountDue")
        except ValueError as exc:
            findings.append(Finding("block", "unreadable_amount", doc_id, str(exc)))
            continue

        residual = total - (paid + credited + due)
        if abs(residual) > TOLERANCE:
            findings.append(
                Finding(
                    "block",
                    "invoice_does_not_reconcile",
                    doc_id,
                    f"Total {total} != paid {paid} + credited {credited} + due {due} "
                    f"(off by {residual}). Something is missing from what was fetched.",
                )
            )

        try:
            referenced = sum((_amount(p, "Amount") for p in inv.get("Payments") or []), Decimal(0))
        except ValueError as exc:
            findings.append(Finding("block", "unreadable_amount", doc_id, str(exc)))
            continue

        if abs(referenced - paid) > TOLERANCE:
            findings.append(
                Finding(
                    "block",
                    "payment_references_incomplete",
                    doc_id,
                    f"AmountPaid {paid} but referenced payments total {referenced}. "
                    "An invoice fetched without its payments under-reports collections "
                    "while looking complete.",
                )
            )

        if credited:
            # AmountCredited also covers pre- and overpayments, which are not the
            # same thing as a credit note. We flag rather than invent an
            # allocation: guessing here silently converts money we hold on
            # account into money we collected.
            findings.append(
                Finding(
                    "review",
                    "review_credit_allocation",
                    doc_id,
                    f"AmountCredited {credited} may include pre/overpayments; "
                    "allocation needs review before it counts as collected.",
                )
            )

    return GateResult(findings)


#: Response keys a payment's parent document may arrive under.
_PARENT_KEYS = ("Invoice", "CreditNote", "Prepayment", "Overpayment")

#: The id field inside each of those, and the document id it should match.
_ID_FIELDS = ("InvoiceID", "CreditNoteID", "PrepaymentID", "OverpaymentID")


def payment_parent(payment: dict, document_id: str) -> dict | None:
    """Find a payment's parent document **by id**, not by response key name.

    Xero returns a credit note's payment (``PaymentType=ARCREDITPAYMENT``) under
    the ``Invoice`` key, and the ``InvoiceID`` there carries the *CreditNoteID* --
    not any invoice id at all. Measured in the legacy system against a real
    tenant, and reported publicly as XeroAPI/xero-ruby#48, which noticed the key
    but not the id substitution.

    Reading ``payment[kind]`` for the kind being processed therefore finds
    nothing for credit notes, and the run fails with "payment identity mismatch"
    on data that is completely sound. That is fail-closed behaviour catching the
    wrong thing, which is worse than not checking: it trains people to override
    the check.

    The check is **not relaxed** to fix it. A parent bearing the wrong id is
    still rejected; we simply stop assuming the key name tells us the type.
    """
    for key in _PARENT_KEYS:
        parent = payment.get(key)
        if not isinstance(parent, dict):
            continue
        for id_field in _ID_FIELDS:
            if parent.get(id_field) == document_id:
                return parent
    return None
