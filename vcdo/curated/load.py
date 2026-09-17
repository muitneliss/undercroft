"""Read raw from the lake, curate it, and publish to Postgres.

Publishing is **atomic and generation-based**. Rows are written inside one
transaction that also marks a generation published; if anything fails, the
transaction rolls back and the previous generation keeps serving with its
freshness visible. A dashboard never shows half a load.

Upserts are keyed on ``(source, tenant_id, source_record_id)`` and are
idempotent: re-running a load over unchanged raw produces identical rows. That is
tested, because it is the property that makes "drop and rebuild from raw" safe.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from vcdo.core.obs_log import ObsLog, run_id
from vcdo.core.run_ledger import stage
from vcdo.curated.hubspot import CuratedCustomer, CuratedDeal, Rejected, to_customer, to_deal
from vcdo.lake.store import LakeStore

__all__ = ["publish_hubspot", "PublishResult", "flush_run_ledger"]


@dataclass(frozen=True, slots=True)
class PublishResult:
    run_id: str
    customers: int
    deals: int
    quarantined: int


def _read_raw(lake: LakeStore, source: str, tenant_id: str, entity: str) -> list[dict]:
    """Every current observation for one entity, newest version of each record.

    Scoped to one tenant. Reading across tenants would let one customer's records
    publish into another's curated rows -- the same reason the tenant is in the
    lake key.
    """
    prefix = f"records/{source}/{tenant_id}/{entity}/"
    ids = sorted({key[len(prefix) :].split("/", 1)[0] for key in lake._store.list(prefix)})
    out = []
    for record_id in ids:
        if not record_id:
            continue
        out.append(json.loads(lake.read(f"{prefix}{record_id}")))
    return out


def publish_hubspot(lake: LakeStore, conn: Any, log: ObsLog, tenant_id: str) -> PublishResult:
    """Curate and publish one tenant's HubSpot raw into Postgres, atomically."""
    current_run = run_id()
    customers: list[tuple[CuratedCustomer, str]] = []
    deals: list[tuple[CuratedDeal, str]] = []
    rejects: list[tuple[dict, Rejected, str]] = []

    with stage("curate:hubspot", log) as st:
        read = 0
        for entity in ("companies", "contacts"):
            for raw in _read_raw(lake, "hubspot", tenant_id, entity):
                read += 1
                key = f"records/hubspot/{tenant_id}/{entity}/{raw['source_record_id']}"
                result = to_customer(raw)
                if isinstance(result, Rejected):
                    rejects.append((raw, result, key))
                    st.excluded(1, result.reason_code)
                else:
                    customers.append((result, key))

        for raw in _read_raw(lake, "hubspot", tenant_id, "deals"):
            read += 1
            key = f"records/hubspot/{tenant_id}/deals/{raw['source_record_id']}"
            result = to_deal(raw)
            if isinstance(result, Rejected):
                rejects.append((raw, result, key))
                st.excluded(1, result.reason_code)
            else:
                deals.append((result, key))

        st.rows_in(read)
        st.rows_out(len(customers) + len(deals))

    # One transaction. Either the whole generation publishes or none of it does.
    with conn.transaction():
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO ops.generation (run_id, status) VALUES (%s, 'building') RETURNING id",
            (current_run,),
        )
        row = cur.fetchone()
        assert row is not None
        generation_id = row[0]

        for customer, key in customers:
            _upsert_customer(cur, customer, current_run, key)
        for deal, key in deals:
            _upsert_deal(cur, deal, current_run, key)
        for raw, reject, key in rejects:
            _quarantine(cur, raw, reject, current_run, key)

        cur.execute(
            "UPDATE ops.generation SET status = 'published', published_at = now() WHERE id = %s",
            (generation_id,),
        )

    log.finish(
        "published hubspot generation",
        customers=len(customers),
        deals=len(deals),
        quarantined=len(rejects),
    )
    return PublishResult(current_run, len(customers), len(deals), len(rejects))


def _upsert_customer(cur: Any, c: CuratedCustomer, run: str, key: str) -> None:
    cur.execute(
        """
        INSERT INTO curated.customers (
            source, tenant_id, source_record_id, display_name, normalised_name,
            domain, email, lifecycle_stage, industry, customer_kind,
            source_created_at, source_updated_at, run_id, lake_key, built_at
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
        ON CONFLICT (source, tenant_id, source_record_id) DO UPDATE SET
            display_name      = EXCLUDED.display_name,
            normalised_name   = EXCLUDED.normalised_name,
            domain            = EXCLUDED.domain,
            email             = EXCLUDED.email,
            lifecycle_stage   = EXCLUDED.lifecycle_stage,
            industry          = EXCLUDED.industry,
            customer_kind     = EXCLUDED.customer_kind,
            source_created_at = EXCLUDED.source_created_at,
            source_updated_at = EXCLUDED.source_updated_at,
            run_id            = EXCLUDED.run_id,
            lake_key          = EXCLUDED.lake_key,
            built_at          = now()
        """,
        (
            c.source,
            c.tenant_id,
            c.source_record_id,
            c.display_name,
            c.normalised_name,
            c.domain,
            c.email,
            c.lifecycle_stage,
            c.industry,
            c.customer_kind,
            c.source_created_at,
            c.source_updated_at,
            run,
            key,
        ),
    )


def _upsert_deal(cur: Any, d: CuratedDeal, run: str, key: str) -> None:
    cur.execute(
        """
        INSERT INTO curated.deals (
            source, tenant_id, source_record_id, deal_name, stage, pipeline,
            is_won, is_closed, amount, currency, closed_on,
            source_created_at, source_updated_at, run_id, lake_key, built_at
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
        ON CONFLICT (source, tenant_id, source_record_id) DO UPDATE SET
            deal_name         = EXCLUDED.deal_name,
            stage             = EXCLUDED.stage,
            pipeline          = EXCLUDED.pipeline,
            is_won            = EXCLUDED.is_won,
            is_closed         = EXCLUDED.is_closed,
            amount            = EXCLUDED.amount,
            currency          = EXCLUDED.currency,
            closed_on         = EXCLUDED.closed_on,
            source_created_at = EXCLUDED.source_created_at,
            source_updated_at = EXCLUDED.source_updated_at,
            run_id            = EXCLUDED.run_id,
            lake_key          = EXCLUDED.lake_key,
            built_at          = now()
        """,
        (
            d.source,
            d.tenant_id,
            d.source_record_id,
            d.deal_name,
            d.stage,
            d.pipeline,
            d.is_won,
            d.is_closed,
            d.amount,
            d.currency,
            d.closed_on,
            d.source_created_at,
            d.source_updated_at,
            run,
            key,
        ),
    )


def _quarantine(cur: Any, raw: dict, reject: Rejected, run: str, key: str) -> None:
    cur.execute(
        """
        INSERT INTO dq.quarantine (
            run_id, source, entity, source_record_id, reason_code, detail, payload, lake_key
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (
            run,
            raw.get("source", "hubspot"),
            raw.get("entity", ""),
            raw.get("source_record_id"),
            reject.reason_code,
            reject.detail,
            json.dumps(raw.get("payload") or {}),
            key,
        ),
    )


def flush_run_ledger(conn: Any, log_dir: str, only_run: str | None = None) -> int:
    """Project the JSONL run ledger into ``ops.run_ledger``.

    The JSONL stream stays the primary write: it is flock-protected, survives a
    database outage, and works before Postgres exists. Postgres is the queryable
    projection, consistent with the rule that everything in the database is a
    projection and may be rebuilt.

    Idempotent on ``(run_id, stage)``, so flushing twice is harmless and a
    partially-flushed run completes cleanly on retry.
    """
    from pathlib import Path

    from vcdo.core.run_ledger import STREAM

    path = Path(log_dir) / f"{STREAM}.jsonl"
    if not path.exists():
        return 0

    flushed = 0
    cur = conn.cursor()
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if only_run and row.get("run_id") != only_run:
            continue
        if "stage" not in row or "status" not in row:
            continue
        cur.execute(
            """
            INSERT INTO ops.run_ledger (
                run_id, stage, status, duration_ms, rows_in, rows_out,
                rows_excluded, excluded_by_reason, unaccounted, error_type
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (run_id, stage) DO UPDATE SET
                status            = EXCLUDED.status,
                duration_ms       = EXCLUDED.duration_ms,
                rows_in           = EXCLUDED.rows_in,
                rows_out          = EXCLUDED.rows_out,
                rows_excluded     = EXCLUDED.rows_excluded,
                excluded_by_reason = EXCLUDED.excluded_by_reason,
                unaccounted       = EXCLUDED.unaccounted,
                error_type        = EXCLUDED.error_type
            """,
            (
                row["run_id"],
                row["stage"],
                row["status"],
                row.get("duration_ms", 0),
                row.get("rows_in", 0),
                row.get("rows_out", 0),
                row.get("rows_excluded", 0),
                json.dumps(row.get("excluded_by_reason") or {}),
                row.get("unaccounted", 0),
                row.get("error_type"),
            ),
        )
        flushed += 1
    return flushed
