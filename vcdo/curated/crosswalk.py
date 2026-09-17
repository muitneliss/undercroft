"""Resolve which records across sources describe the same real-world entity.

**Gather claims, then decide.** Two separate steps, deliberately. Collecting
evidence and adjudicating it in one pass makes the decision impossible to
inspect: you get an answer with no record of what supported it, and no way to
re-decide when the rules change without re-reading every source.

The governing rule, from the legacy system's entity-identity laws: a machine may
only merge on **hard identifiers**. A matching normalised name is enough to
*propose* a link for review; it is never enough to merge. Over-merging is the
expensive direction — it silently unites two customers, and every figure derived
from them is wrong in a way that looks entirely plausible.

Three of those laws apply directly here:

**Never merge on a person's name.** "Phong" and "Phung Nguyen Phong" are two
people. Contacts therefore match on their *company* claim, never on themselves.

**Never key identity on a volatile id.** The legacy system froze positional keys
(``vcc-sg-drive-NNNN``) and a rebuild renumbered them: 178 of 358 mappings came
to point at a different company. Keys here are UEN or durable name only.

**Unresolved returns empty.** A wrong code is worse than an empty cell, because
an empty cell is visibly missing and a wrong code is invisibly false.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from vcdo.core.names import norm_name

__all__ = ["Claim", "Candidate", "build_claims", "decide", "RULE_REVISION", "HARD_BASES"]

#: Bump when the rules below change. Stamped on every decision so a row can be
#: traced to the logic that produced it, and so a re-decision is distinguishable
#: from the original.
RULE_REVISION = "crosswalk/1"

#: Evidence strong enough to merge on its own.
#:
#: `uen` is a government-issued company number: two records carrying the same one
#: are the same legal entity. `owner_asserted` is a human decision already
#: recorded. `canonical_name` is an exact normalised-name match with no
#: contradicting identifier.
HARD_BASES = frozenset({"owner_asserted", "uen", "canonical_name"})

#: Evidence that may propose a link but never decide one.
WEAK_BASES = frozenset({"email_domain", "name_with_conflicting_uen"})

#: Domains that identify a mail provider, not a company. Matching on these would
#: merge every customer who happens to use Gmail into one entity.
_PUBLIC_DOMAINS = frozenset(
    {
        "gmail.com",
        "googlemail.com",
        "yahoo.com",
        "hotmail.com",
        "outlook.com",
        "icloud.com",
        "protonmail.com",
        "qq.com",
        "163.com",
        "example.test",
    }
)


@dataclass(frozen=True, slots=True)
class Claim:
    basis: str
    reference: str

    @property
    def is_hard(self) -> bool:
        return self.basis in HARD_BASES


@dataclass(frozen=True, slots=True)
class Candidate:
    """One source record's proposed identity, with the evidence behind it."""

    source: str
    source_record_id: str
    entity_key: str | None
    status: str
    reason: str
    evidence_strength: str
    claims: list[Claim] = field(default_factory=list)
    rule_revision: str = RULE_REVISION

    @property
    def is_linked(self) -> bool:
        return self.status == "active"


def _domain_of(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    domain = email.rsplit("@", 1)[1].strip().lower()
    return None if domain in _PUBLIC_DOMAINS else domain


def build_claims(record: dict) -> list[Claim]:
    """Collect every claim a record makes about its identity.

    Collection only. Nothing here decides anything, and nothing is discarded for
    being weak — a weak claim is still evidence, and a candidate with several of
    them is a better review item than one with none.
    """
    claims: list[Claim] = []

    uen = (record.get("uen") or "").strip()
    if uen:
        claims.append(Claim("uen", uen))

    if record.get("owner_asserted_entity"):
        claims.append(Claim("owner_asserted", str(record["owner_asserted_entity"])))

    # A person matches on the COMPANY they claim, never on their own name.
    # Normalising a personal name and matching on it is the given-name merge the
    # identity laws forbid.
    name_source = record.get("company_name") if record.get("kind") == "person" else record.get("name")
    normalised = norm_name(name_source)
    if normalised:
        claims.append(Claim("canonical_name", normalised))

    domain = _domain_of(record.get("email")) or (record.get("domain") or "").strip().lower() or None
    if domain:
        claims.append(Claim("email_domain", domain))

    return claims


def decide(records: list[dict]) -> list[Candidate]:
    """Adjudicate claims into linking decisions.

    Statuses, and what each means operationally:

    ``active``    exactly one hard claim agrees -- safe to join.
    ``review_conflict``  two or more *different* hard identifiers. Someone must
                  look: this is usually a data-entry error upstream, and
                  guessing would merge two real companies.
    ``proposed``  only weak evidence. Goes to the review queue and is NOT joined.
    ``unlinked``  no claims at all. A legitimate, common state.
    """
    claims_by_record = {}
    hard_index: dict[tuple[str, str], set[str]] = defaultdict(set)

    for record in records:
        key = (record["source"], record["source_record_id"])
        claims = build_claims(record)
        claims_by_record[key] = claims
        for claim in claims:
            if claim.is_hard:
                hard_index[(claim.basis, claim.reference)].add(f"{key[0]}:{key[1]}")

    candidates: list[Candidate] = []
    for record in records:
        key = (record["source"], record["source_record_id"])
        claims = claims_by_record[key]
        hard = [c for c in claims if c.is_hard]

        # A UEN outranks a name. Two records with the same name but different
        # UENs are different companies, and the name must not be allowed to
        # overrule the identifier.
        uens = {c.reference for c in hard if c.basis == "uen"}
        if len(uens) > 1:
            candidates.append(
                Candidate(
                    *key,
                    None,
                    "review_conflict",
                    "record carries more than one company number",
                    "strong",
                    claims,
                )
            )
            continue

        anchors = {(c.basis, c.reference) for c in hard}
        if not anchors:
            weak = [c for c in claims if c.basis in WEAK_BASES]
            candidates.append(
                Candidate(
                    *key,
                    None,
                    "proposed" if weak else "unlinked",
                    "only weak evidence; needs review" if weak else "no identity claims",
                    "weak" if weak else "none",
                    claims,
                )
            )
            continue

        # Prefer the strongest available anchor as the key: owner decision, then
        # company number, then name.
        for basis in ("owner_asserted", "uen", "canonical_name"):
            match = next((c for c in hard if c.basis == basis), None)
            if match:
                break
        assert match is not None

        entity_key = f"{match.basis}:{match.reference}"
        candidates.append(
            Candidate(
                *key,
                entity_key,
                "active",
                f"linked on {match.basis}",
                "strong",
                claims,
            )
        )

    return candidates
