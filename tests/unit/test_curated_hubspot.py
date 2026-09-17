"""Curating HubSpot records must never invent a value.

These pin the cases where the obvious implementation silently produces a
plausible wrong answer: a missing amount becoming zero, an unparseable date
becoming today, a person's name being used to match companies.
"""

from decimal import Decimal

from vcdo.curated.hubspot import DEFAULT_CURRENCY, Rejected, to_customer, to_deal


def raw(entity: str, record_id: str, props: dict, **envelope) -> dict:
    return {
        "source": "hubspot",
        "tenant_id": "portal-test",
        "entity": entity,
        "source_record_id": record_id,
        "payload": {"id": record_id, "properties": props, **envelope},
    }


# -- deals: money ------------------------------------------------------------


def test_a_deal_with_no_amount_is_null_not_zero():
    """Zero is indistinguishable from a real zero, so it is data loss that looks like a fact."""
    deal = to_deal(raw("deals", "1", {"dealname": "scoping", "amount": ""}))

    assert not isinstance(deal, Rejected)
    assert deal.amount is None
    assert deal.currency is None


def test_an_amount_present_but_unreadable_is_quarantined_not_blanked():
    """Absent is ordinary; unreadable is a defect and must be visible."""
    result = to_deal(raw("deals", "1", {"amount": "three thousand"}))

    assert isinstance(result, Rejected)
    assert result.reason_code == "unreadable_amount"


def test_amounts_are_exact_decimals():
    deal = to_deal(raw("deals", "1", {"amount": "1200.50"}))

    assert not isinstance(deal, Rejected)
    assert deal.amount == Decimal("1200.50")
    assert isinstance(deal.amount, Decimal)


def test_every_amount_carries_a_currency():
    """An amount without a currency cannot be summed, compared or converted."""
    deal = to_deal(raw("deals", "1", {"amount": "100"}))

    assert not isinstance(deal, Rejected)
    assert deal.currency == DEFAULT_CURRENCY


def test_portal_currency_is_pinned_so_a_silent_reconfiguration_is_caught():
    """HubSpot's amount carries no currency; we assert the portal's.

    If the portal is reconfigured or multi-currency deals are enabled, this
    assumption becomes wrong silently. This test is the tripwire.
    """
    assert DEFAULT_CURRENCY == "SGD"


# -- deals: stage ------------------------------------------------------------


def test_won_and_lost_are_distinguished_from_open():
    won = to_deal(raw("deals", "1", {"dealstage": "closedwon"}))
    lost = to_deal(raw("deals", "2", {"dealstage": "closedlost"}))
    open_ = to_deal(raw("deals", "3", {"dealstage": "qualifiedtobuy"}))

    assert (won.is_won, won.is_closed) == (True, True)
    assert (lost.is_won, lost.is_closed) == (False, True)
    assert (open_.is_won, open_.is_closed) == (False, False)


def test_an_absent_stage_is_unknown_not_lost():
    """False would assert the deal was not won. We do not know that."""
    deal = to_deal(raw("deals", "1", {}))

    assert deal.is_won is None
    assert deal.is_closed is None


# -- dates -------------------------------------------------------------------


def test_an_unparseable_date_is_null_rather_than_now():
    """A wrong timestamp makes a stale record look fresh and defeats freshness checks."""
    deal = to_deal(raw("deals", "1", {"closedate": "not-a-date"}, updatedAt="also-not-a-date"))

    assert deal.closed_on is None
    assert deal.source_updated_at is None


# -- customers ---------------------------------------------------------------


def test_a_company_without_a_name_is_quarantined():
    """A nameless row cannot be matched, reviewed or shown, and would sit in the mart forever."""
    result = to_customer(raw("companies", "1", {"name": "  "}))

    assert isinstance(result, Rejected)
    assert result.reason_code == "missing_name"


def test_legal_forms_do_not_prevent_a_company_matching_itself():
    a = to_customer(raw("companies", "1", {"name": "Synthetic Alpha Pte Ltd"}))
    b = to_customer(raw("companies", "2", {"name": "SYNTHETIC ALPHA PTE. LTD."}))

    assert a.normalised_name == b.normalised_name != ""


def test_a_contact_matches_on_its_company_not_its_person_name():
    """Matching on a person's name is the given-name merge the entity laws forbid.

    'Phong' and 'Phung Nguyen Phong' are two people; a normalised personal name
    would merge them.
    """
    contact = to_customer(
        raw("contacts", "1", {"firstname": "Anh", "lastname": "Nguyen", "company": "Synthetic Alpha Pte Ltd"})
    )

    assert contact.display_name == "Anh Nguyen"
    assert contact.normalised_name == "syntheticalpha"


def test_a_contact_with_no_company_gets_an_empty_matching_key():
    """Empty, not a guess from the person's name. An unresolved key is visibly missing."""
    contact = to_customer(raw("contacts", "1", {"firstname": "Dung", "email": "dung@example.test"}))

    assert contact.normalised_name == ""
    assert contact.display_name == "Dung"


def test_unset_properties_become_null_not_empty_string():
    """HubSpot returns "" for unset; storing that makes unset and blank indistinguishable."""
    company = to_customer(raw("companies", "1", {"name": "Synthetic Gamma Holdings", "domain": ""}))

    assert company.domain is None


def test_a_record_without_an_id_is_refused():
    """It cannot be upserted, deduplicated or traced."""
    result = to_customer(
        {"source": "hubspot", "tenant_id": "t", "entity": "companies", "source_record_id": "", "payload": {}}
    )

    assert isinstance(result, Rejected)
    assert result.reason_code == "missing_source_id"
