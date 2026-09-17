"""Transform raw HubSpot records into curated customers and deals.

Pure functions over a raw record. No network, no database, no clock. That is what
makes them testable, and what makes a rebuild from the lake produce byte-identical
rows -- the property the whole "raw is the only durable layer" design rests on.

The rule that governs every field here: **never guess.** An unreadable amount is
``None``, not ``0``. An unparseable date is ``None``, not today. A row we cannot
read at all is quarantined with its payload and a reason code, not dropped.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from vcdo.core.money import parse_amount
from vcdo.core.names import norm_name

__all__ = ["CuratedCustomer", "CuratedDeal", "Rejected", "to_customer", "to_deal", "DEFAULT_CURRENCY"]

#: HubSpot's `amount` property carries no currency -- it is denominated in the
#: portal's configured currency, which the object payload never states. We record
#: the portal currency explicitly rather than leaving it NULL, because an amount
#: with no currency cannot be summed or compared and the schema rightly forbids it.
#:
#: This is a CONFIGURED FACT about the portal, not an inference. If the portal is
#: ever reconfigured, or multi-currency deals are enabled, this becomes wrong
#: silently -- so it is pinned by a test and must be re-verified against the live
#: portal before HubSpot goes to `live` mode.
DEFAULT_CURRENCY = "SGD"

#: Stages HubSpot treats as terminal. Anything else is open.
_WON_STAGES = {"closedwon"}
_LOST_STAGES = {"closedlost"}


@dataclass(frozen=True, slots=True)
class Rejected:
    """A record that could not be curated. Goes to dq.quarantine with its payload."""

    reason_code: str
    detail: str


@dataclass(frozen=True, slots=True)
class CuratedCustomer:
    source: str
    tenant_id: str
    source_record_id: str
    display_name: str | None
    normalised_name: str
    domain: str | None
    email: str | None
    lifecycle_stage: str | None
    industry: str | None
    customer_kind: str
    source_created_at: datetime | None
    source_updated_at: datetime | None


@dataclass(frozen=True, slots=True)
class CuratedDeal:
    source: str
    tenant_id: str
    source_record_id: str
    deal_name: str | None
    stage: str | None
    pipeline: str | None
    is_won: bool | None
    is_closed: bool | None
    amount: Decimal | None
    currency: str | None
    closed_on: date | None
    source_created_at: datetime | None
    source_updated_at: datetime | None


def to_customer(raw: dict) -> CuratedCustomer | Rejected:
    """Curate a HubSpot company or contact into a customer row."""
    entity = raw.get("entity")
    payload = raw.get("payload") or {}
    props = payload.get("properties") or {}
    record_id = raw.get("source_record_id") or ""

    if not record_id:
        return Rejected("missing_source_id", "record has no HubSpot id and cannot be keyed")

    if entity == "companies":
        display = _clean(props.get("name"))
        kind = "company"
        email = None
    elif entity == "contacts":
        display = _person_name(props)
        kind = "person"
        email = _clean(props.get("email"))
    else:
        return Rejected("unsupported_entity", f"{entity!r} is not a customer-bearing entity")

    # A company with no readable name is quarantined rather than stored blank.
    # A nameless row cannot be matched, reviewed, or shown, and it would sit in
    # the mart forever looking like data.
    if kind == "company" and not display:
        return Rejected("missing_name", "company has no name property")

    return CuratedCustomer(
        source=raw.get("source", "hubspot"),
        tenant_id=raw.get("tenant_id", ""),
        source_record_id=record_id,
        display_name=display,
        # Contacts normalise their *company* claim, not their personal name.
        # Normalising a person's name and matching on it is exactly the
        # given-name merge that the legacy entity laws forbid: "Phong" and
        # "Phung Nguyen Phong" are two people.
        normalised_name=norm_name(props.get("company") if kind == "person" else display),
        domain=_clean(props.get("domain")),
        email=email,
        lifecycle_stage=_clean(props.get("lifecyclestage")),
        industry=_clean(props.get("industry")),
        customer_kind=kind,
        source_created_at=_ts(payload.get("createdAt")),
        source_updated_at=_ts(payload.get("updatedAt")),
    )


def to_deal(raw: dict) -> CuratedDeal | Rejected:
    """Curate a HubSpot deal."""
    payload = raw.get("payload") or {}
    props = payload.get("properties") or {}
    record_id = raw.get("source_record_id") or ""

    if not record_id:
        return Rejected("missing_source_id", "record has no HubSpot id and cannot be keyed")

    stage = _clean(props.get("dealstage"))
    is_won = stage in _WON_STAGES if stage else None
    is_closed = stage in (_WON_STAGES | _LOST_STAGES) if stage else None

    raw_amount = props.get("amount")
    amount = parse_amount(raw_amount)

    # An amount that was present but unreadable is a defect worth surfacing, not
    # a blank. An absent amount is ordinary -- an open deal often has none.
    if amount is None and _clean(raw_amount):
        return Rejected("unreadable_amount", f"amount {raw_amount!r} could not be parsed")

    return CuratedDeal(
        source=raw.get("source", "hubspot"),
        tenant_id=raw.get("tenant_id", ""),
        source_record_id=record_id,
        deal_name=_clean(props.get("dealname")),
        stage=stage,
        pipeline=_clean(props.get("pipeline")),
        is_won=is_won,
        is_closed=is_closed,
        amount=amount,
        currency=DEFAULT_CURRENCY if amount is not None else None,
        closed_on=_date(props.get("closedate")),
        source_created_at=_ts(payload.get("createdAt")),
        source_updated_at=_ts(payload.get("updatedAt")),
    )


# -- helpers -----------------------------------------------------------------


def _clean(value: object) -> str | None:
    """Empty string and whitespace become None.

    HubSpot returns "" for unset properties. Storing that as an empty string
    makes "unset" and "deliberately blank" indistinguishable in SQL, and makes
    every downstream filter need to check both.
    """
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _person_name(props: dict) -> str | None:
    parts = [_clean(props.get("firstname")), _clean(props.get("lastname"))]
    joined = " ".join(p for p in parts if p)
    return joined or None


def _ts(value: object) -> datetime | None:
    text = _clean(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        # Never fall back to now(). A wrong timestamp is worse than a missing
        # one: it makes a stale record look fresh and defeats every freshness
        # check built on top of it.
        return None


def _date(value: object) -> date | None:
    ts = _ts(value)
    return ts.date() if ts else None
