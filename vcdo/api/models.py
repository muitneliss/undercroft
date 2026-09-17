"""Response models for the control plane.

**Money never crosses this boundary as a number.** `.claude/rules/data-integrity.md`
bans `float` for a monetary amount, and JavaScript's `number` *is* a float --
`JSON.parse` on `8500.0001` and on a 20-digit total both give you something the
browser will happily round and then display as fact.

A custom JSON encoder is not enough to prevent that, and this is the specific
trap worth naming: FastAPI's ``jsonable_encoder`` and Pydantic v2's
``model_dump(mode="json")`` both convert a ``Decimal`` to ``float`` *before* any
encoder of ours is consulted. So the type never appears in a response model at
all. :class:`Money` carries the digits as a string beside their currency, and
:func:`assert_no_bare_numbers` is the gate test's way of proving no model
regressed.

**Three-valued comparison stays three-valued.** ``unverified`` is a real outcome,
not a soft pass and not a soft failure, so it crosses as its own literal and the
UI renders three states. Collapsing it into a boolean here would make that
impossible downstream no matter what the frontend intended.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

__all__ = [
    "Money",
    "Verdict",
    "ConnectionOut",
    "TenantOut",
    "UserOut",
    "LakeObjectOut",
    "assert_no_bare_numbers",
]

#: ok / mismatch / unverified. See vcdo/core/money.py and the data-integrity rule.
Verdict = Literal["ok", "mismatch", "unverified"]


class Money(BaseModel):
    """An amount and its currency, with the amount as digits.

    Two amounts in different currencies are not comparable, so the currency is
    not optional and is never defaulted -- an ambient "they're all SGD anyway"
    is exactly the implicit conversion the rules forbid.
    """

    amount: str
    currency: str

    @staticmethod
    def of(amount: Decimal | None, currency: str) -> Money | None:
        """Build from a ``Decimal``, or ``None`` when there is nothing to show.

        ``None`` in, ``None`` out -- never ``"0"``. SQL ``sum()`` over no rows is
        NULL, and rendering that as zero would turn "we have no data" into "the
        figure is nought", which is a fact nobody established.
        """
        if amount is None:
            return None
        return Money(amount=str(amount), currency=currency)


class TenantOut(BaseModel):
    id: str
    display_name: str
    status: str
    created_at: datetime


class UserOut(BaseModel):
    id: str
    email: str
    display_name: str
    is_staff: bool
    role: str | None = None


class ConnectionOut(BaseModel):
    source: str
    status: str
    external_account_id: str = ""
    external_account_label: str = ""
    scopes: list[str] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)
    schedule_cron: str = ""
    backfill_from: date | None = None
    last_run_id: str = ""
    #: When the stored credential expires. Null means "no expiry recorded",
    #: which is a real state (a HubSpot private-app token), not "expired".
    expires_at: datetime | None = None


class LakeObjectOut(BaseModel):
    key: str
    versions: int
    newest_sha256: str | None = None
    bytes: int | None = None


#: Fields that are legitimately numeric: counts, durations and sizes. Counting
#: things is exact in a double up to 2^53, and none of these is money.
_NUMERIC_ALLOWED = {"versions", "bytes"}


def assert_no_bare_numbers(model: type[BaseModel]) -> list[str]:
    """Return the fields of ``model`` that would reach the browser as floats.

    Used by the gate test. Walks the generated JSON Schema rather than the
    annotations, because the schema is what FastAPI actually serialises against
    -- which is the layer where ``Decimal`` silently becomes ``number``.
    """
    schema = model.model_json_schema()
    offenders = []

    def walk(node: Any, path: str) -> None:
        if not isinstance(node, dict):
            return
        for name, spec in (node.get("properties") or {}).items():
            if not isinstance(spec, dict):
                continue
            here = f"{path}.{name}" if path else name
            types = {spec.get("type")} | {
                option.get("type") for option in spec.get("anyOf", []) if isinstance(option, dict)
            }
            if "number" in types and name not in _NUMERIC_ALLOWED:
                offenders.append(here)
            walk(spec, here)

    walk(schema, "")
    for definition in (schema.get("$defs") or {}).values():
        walk(definition, "")
    return offenders
