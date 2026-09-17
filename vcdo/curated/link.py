"""Populate ``entity_id`` across curated rows.

Runs **after** both sources have published, not during either. Linking is a
cross-source operation by definition: it needs HubSpot and Xero rows to exist
simultaneously, so doing it inside one source's publish would link against
whatever the other source happened to have last time.

Only ``active`` decisions are written. ``proposed`` and ``review_conflict``
land in the review queue with their evidence and leave ``entity_id`` NULL --
which is what makes an unresolved identity visibly missing rather than
invisibly wrong.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from vcdo.core.obs_log import ObsLog, run_id
from vcdo.curated.crosswalk import decide

__all__ = ["link_entities", "LinkResult"]


@dataclass(frozen=True, slots=True)
class LinkResult:
    linked: int
    proposed: int
    conflicted: int
    unlinked: int
    run_id: str


def link_entities(conn: Any, log: ObsLog, tenant_id: str) -> LinkResult:
    current_run = run_id()

    rows = [
        {
            "source": r[0],
            "source_record_id": r[1],
            "name": r[2],
            "company_name": r[3],
            "email": r[4],
            "domain": r[5],
            "kind": r[6],
            "uen": r[7],
        }
        for r in conn.execute(
            """
            SELECT source, source_record_id, display_name, display_name, email, domain,
                   customer_kind, uen
            FROM curated.customers
            WHERE tenant_id = %s
            """,
            (tenant_id,),
        )
    ]

    # A contact row carries the company it claims in `normalised_name`, but the
    # crosswalk wants the raw name so it can normalise consistently. Persons are
    # therefore re-read with their company claim in the right field.
    for row in rows:
        if row["kind"] == "person":
            row["name"] = None

    counts = {"active": 0, "proposed": 0, "review_conflict": 0, "unlinked": 0}

    candidates = decide(rows)

    with conn.transaction():
        cur = conn.cursor()
        for candidate in candidates:
            counts[candidate.status] = counts.get(candidate.status, 0) + 1
            cur.execute(
                """
                UPDATE curated.customers
                SET entity_id = %s
                WHERE tenant_id = %s AND source = %s AND source_record_id = %s
                """,
                (
                    candidate.entity_key if candidate.is_linked else None,
                    tenant_id,
                    candidate.source,
                    candidate.source_record_id,
                ),
            )
            if candidate.status in ("proposed", "review_conflict"):
                cur.execute(
                    """
                    INSERT INTO ops.gate_finding
                        (run_id, source, severity, code, document_id, detail)
                    VALUES (%s, %s, 'review', %s, %s, %s)
                    """,
                    (
                        current_run,
                        candidate.source,
                        f"identity_{candidate.status}",
                        candidate.source_record_id,
                        f"{candidate.reason}; evidence: "
                        + ", ".join(f"{c.basis}={c.reference}" for c in candidate.claims),
                    ),
                )

    log.finish("linked entities", **counts)
    return LinkResult(
        counts["active"], counts["proposed"], counts["review_conflict"], counts["unlinked"], current_run
    )
