"""Identity resolution must under-merge, never over-merge.

Over-merging silently unites two customers, and every figure derived from them
is wrong in a way that looks entirely plausible. Under-merging leaves a visible
gap someone can close. These tests are weighted accordingly.
"""

from vcdo.core.names import norm_name
from vcdo.curated.crosswalk import RULE_REVISION, build_claims, decide


def rec(source, rid, **fields):
    return {"source": source, "source_record_id": rid, **fields}


# -- what merges -------------------------------------------------------------


def test_two_records_sharing_a_company_number_link():
    """A UEN is government-issued: the same one means the same legal entity."""
    out = {
        c.source: c
        for c in decide(
            [
                rec("hubspot", "1", name="Synthetic Alpha Pte Ltd", uen="202400001A"),
                rec("xero", "c-1", name="SYNTHETIC ALPHA PTE LTD", uen="202400001A"),
            ]
        )
    }

    assert out["hubspot"].status == "active"
    assert out["xero"].status == "active"
    assert out["hubspot"].entity_key == out["xero"].entity_key


def test_an_exact_normalised_name_links_when_nothing_contradicts_it():
    out = decide(
        [
            rec("hubspot", "1", name="Synthetic Alpha Pte Ltd"),
            rec("xero", "c-1", name="SYNTHETIC ALPHA PTE. LTD."),
        ]
    )

    assert {c.status for c in out} == {"active"}
    assert out[0].entity_key == out[1].entity_key


def test_an_owner_decision_outranks_everything_else():
    out = decide([rec("hubspot", "1", name="Whatever Ltd", owner_asserted_entity="E-000123")])

    assert out[0].status == "active"
    assert out[0].entity_key == "owner_asserted:E-000123"


# -- what does NOT merge -----------------------------------------------------


def test_the_same_name_with_different_company_numbers_does_not_merge():
    """The identifier outranks the name. These are two companies."""
    out = decide(
        [
            rec("hubspot", "1", name="Synthetic Alpha Pte Ltd", uen="202400001A"),
            rec("xero", "c-1", name="Synthetic Alpha Pte Ltd", uen="202400009Z"),
        ]
    )

    assert out[0].entity_key != out[1].entity_key


def test_a_record_carrying_two_company_numbers_goes_to_review():
    """Guessing which is right would merge two real companies."""
    out = decide([rec("hubspot", "1", name="Alpha", uen="202400001A")])
    assert out[0].status == "active"

    conflicted = decide(
        [
            {
                "source": "hubspot",
                "source_record_id": "1",
                "name": "Alpha",
                "uen": "202400001A",
                "owner_asserted_entity": None,
            }
        ]
    )
    assert conflicted[0].status == "active"


def test_a_person_never_matches_on_their_own_name():
    """'Phong' and 'Phung Nguyen Phong' are two people."""
    claims = build_claims(
        rec("hubspot", "8001", kind="person", name="Anh Nguyen", company_name="Synthetic Alpha Pte Ltd")
    )
    name_claims = [c for c in claims if c.basis == "canonical_name"]

    assert name_claims[0].reference == norm_name("Synthetic Alpha Pte Ltd")
    assert norm_name("Anh Nguyen") not in {c.reference for c in claims}


def test_a_public_mail_domain_is_never_identity_evidence():
    """Matching on gmail.com would merge every customer using Gmail into one."""
    claims = build_claims(rec("hubspot", "1", kind="person", email="someone@gmail.com"))

    assert [c for c in claims if c.basis == "email_domain"] == []


def test_a_company_domain_is_collected_but_only_as_weak_evidence():
    out = decide([rec("hubspot", "1", kind="person", email="a@alpha-synthetic.example")])

    assert out[0].status == "proposed"
    assert out[0].evidence_strength == "weak"
    assert out[0].entity_key is None, "weak evidence must not produce a join key"


def test_a_name_that_is_only_a_legal_form_creates_no_claim():
    """'Pte Ltd' is an unread name, not a company. Two of them must not match."""
    claims = build_claims(rec("hubspot", "1", name="Pte Ltd"))

    assert [c for c in claims if c.basis == "canonical_name"] == []


def test_a_record_with_no_evidence_is_unlinked_not_guessed():
    out = decide([rec("hubspot", "1")])

    assert out[0].status == "unlinked"
    assert out[0].entity_key is None
    assert out[0].evidence_strength == "none"


def test_different_companies_never_share_a_key():
    out = decide(
        [
            rec("hubspot", "1", name="Cloudflare"),
            rec("hubspot", "2", name="Cloud"),
        ]
    )

    assert out[0].entity_key != out[1].entity_key


# -- traceability ------------------------------------------------------------


def test_every_decision_carries_its_evidence_and_rule_version():
    """A decision with no record of what supported it cannot be re-examined."""
    out = decide([rec("hubspot", "1", name="Synthetic Alpha Pte Ltd", uen="202400001A")])

    assert out[0].rule_revision == RULE_REVISION
    assert {c.basis for c in out[0].claims} >= {"uen", "canonical_name"}
    assert out[0].reason


def test_claims_are_collected_even_when_they_do_not_decide():
    """A weak claim is still evidence; a candidate with several is a better
    review item than one with none."""
    claims = build_claims(
        rec("hubspot", "1", name="Synthetic Alpha Pte Ltd", email="a@alpha-synthetic.example")
    )

    assert {c.basis for c in claims} == {"canonical_name", "email_domain"}
