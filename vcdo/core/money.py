"""Fixed-precision money.

Two rules govern this module, and both were learned the expensive way in the
legacy system.

**Never float.** The legacy revenue mart parsed amounts with ``float(value or 0)``
and accumulated in float, formatting to 2dp only at write time. ``quantize`` and
``ROUND_HALF_UP`` appear nowhere in that repo. Every figure that reached a human
had already been through binary floating point.

**Never guess.** An amount that cannot be read returns ``None`` and the caller
records why. It does not become ``0``. A zero is indistinguishable from a real
zero downstream, so a parse failure that returns zero is a silent data loss that
looks like a fact.

Currency is never implicit. Amounts carry their currency, and two amounts in
different currencies are not comparable without an explicit, dated rate --- see
``vcdo.core.fx``. Refusing to compare is a correct answer; guessing is not.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

__all__ = ["Money", "Verdict", "parse_amount", "SCALE", "compare"]

#: Storage scale. Matches ``NUMERIC(18, 4)`` in the curated schema.
#:
#: Four places, not two: FX conversion and unit pricing both produce sub-cent
#: intermediates, and rounding those to 2dp before aggregation is how a ledger
#: drifts by a few cents a month and nobody can say where it went. Presentation
#: rounds to 2; storage keeps 4.
SCALE = Decimal("0.0001")

#: European decimal notation: "1.234,00" means one thousand two hundred
#: thirty-four. Read as US notation it becomes 1.234, off by a factor of a
#: thousand. We refuse rather than pick, because both readings are plausible and
#: only the source system knows which it meant.
_EURO_NOTATION = re.compile(r"\.\d{3},")

_CLEANUP = re.compile(r"[\s '_]")


class Verdict:
    """Three-valued comparison result.

    Boolean verdicts are the trap: they force "no evidence" to land in either
    the pass or the fail bucket. If it lands in pass, the check becomes false
    reassurance --- worse than having no check, because it is trusted.
    """

    OK = "ok"
    MISMATCH = "mismatch"
    UNVERIFIED = "unverified"


@dataclass(frozen=True, slots=True)
class Money:
    """An amount and its currency. Immutable, exact, never implicitly converted."""

    amount: Decimal
    currency: str

    def __post_init__(self) -> None:
        if not isinstance(self.amount, Decimal):
            raise TypeError(f"Money.amount must be Decimal, got {type(self.amount).__name__}")
        if not (isinstance(self.currency, str) and re.fullmatch(r"[A-Z]{3}", self.currency)):
            raise ValueError(f"currency must be an ISO 4217 alpha-3 code, got {self.currency!r}")

    def quantized(self) -> Money:
        """Round to storage scale, half-up.

        Banker's rounding (Python's default) is correct for statistics and wrong
        for invoices: customers and auditors expect .5 to round away from zero.
        """
        from decimal import ROUND_HALF_UP

        return Money(self.amount.quantize(SCALE, rounding=ROUND_HALF_UP), self.currency)

    def __add__(self, other: Money) -> Money:
        self._assert_same_currency(other, "add")
        return Money(self.amount + other.amount, self.currency)

    def __sub__(self, other: Money) -> Money:
        self._assert_same_currency(other, "subtract")
        return Money(self.amount - other.amount, self.currency)

    def _assert_same_currency(self, other: object, verb: str) -> None:
        # Typed as `object` because Python does not enforce annotations at
        # runtime, so this check is genuinely reachable from untyped callers.
        if not isinstance(other, Money):
            raise TypeError(f"cannot {verb} {type(other).__name__} and Money")
        if self.currency != other.currency:
            # Deliberately an exception, not a silent conversion. Mixed-currency
            # arithmetic is always a bug at this layer; conversion is an explicit
            # step with a dated rate, performed by the caller who knows the date.
            raise ValueError(
                f"refusing to {verb} {self.currency} and {other.currency}: "
                "convert explicitly through a dated FX rate first"
            )

    def __str__(self) -> str:
        return f"{self.amount} {self.currency}"


def parse_amount(value: object) -> Decimal | None:
    """Read an amount exactly. Return ``None`` if it cannot be read.

    Accepts ``Decimal``, ``int``, and strings with thousands separators or a
    currency symbol. Rejects ``float`` outright: by the time a float arrives the
    precision loss has already happened, and accepting it here would launder a
    defect into the curated layer.
    """
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        # bool is an int subclass; True would silently become 1.
        return None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        raise TypeError(
            "refusing to parse a float into money: the precision loss already happened "
            "upstream. Pass the original string or Decimal."
        )
    if not isinstance(value, str):
        return None

    text = _CLEANUP.sub("", value)
    if _EURO_NOTATION.search(text):
        return None

    text = text.replace(",", "")
    # Strip a leading currency symbol or trailing code; keep sign and digits.
    text = re.sub(r"^[^\d\-+.]+", "", text)
    text = re.sub(r"[^\d]+$", "", text) if not text[-1:].isdigit() else text
    if not text or text in {"-", "+", "."}:
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def compare(observed: Money | None, expected: Money | None, tolerance: Decimal = Decimal("0.02")) -> str:
    """Compare two amounts, returning a :class:`Verdict`.

    A currency mismatch is ``UNVERIFIED``, not ``MISMATCH``. 4,000 SGD and
    4,000 USD are not in agreement, but neither have we shown they disagree ---
    we have shown we cannot tell. Reporting that as a mismatch sends someone to
    investigate a discrepancy that may not exist.

    Missing evidence on either side is ``UNVERIFIED``. It is never ``OK``.
    """
    if observed is None or expected is None:
        return Verdict.UNVERIFIED
    if observed.currency != expected.currency:
        return Verdict.UNVERIFIED
    if abs(observed.amount - expected.amount) <= tolerance:
        return Verdict.OK
    return Verdict.MISMATCH
