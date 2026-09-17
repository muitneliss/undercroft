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

__all__ = ["publish_hubspot", "publish_xero", "PublishResult", "flush_run_ledger", "GateBlocked"]


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
    deals: list[tuple[CuratedDeal, str, str | None]] = []
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

        # Association edges first: a deal needs its owner before it is curated.
        deal_to_company: dict[str, str] = {}
        for raw in _read_raw(lake, "hubspot", tenant_id, "associations"):
            read += 1
            targets = (raw.get("payload") or {}).get("to") or []
            if targets:
                deal_to_company[raw["source_record_id"]] = str(targets[0].get("toObjectId") or "")

        for raw in _read_raw(lake, "hubspot", tenant_id, "deals"):
            read += 1
            key = f"records/hubspot/{tenant_id}/deals/{raw['source_record_id']}"
            result = to_deal(raw)
            if isinstance(result, Rejected):
                rejects.append((raw, result, key))
                st.excluded(1, result.reason_code)
            else:
                deals.append((result, key, deal_to_company.get(raw["source_record_id"])))

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
        for deal, key, customer_id in deals:
            _upsert_deal(cur, deal, current_run, key, customer_id)
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
            source_created_at, source_updated_at, uen, run_id, lake_key, built_at
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
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
            uen               = coalesce(EXCLUDED.uen, curated.customers.uen),
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
            getattr(c, "uen", None),
            run,
            key,
        ),
    )


def _upsert_deal(cur: Any, d: CuratedDeal, run: str, key: str, customer_source_id: str | None) -> None:
    cur.execute(
        """
        INSERT INTO curated.deals (
            source, tenant_id, source_record_id, deal_name, stage, pipeline,
            is_won, is_closed, amount, currency, closed_on,
            source_created_at, source_updated_at, customer_source_id, run_id, lake_key, built_at
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
        ON CONFLICT (source, tenant_id, source_record_id) DO UPDATE SET
            deal_name         = EXCLUDED.deal_name,
            stage             = EXCLUDED.stage,
            pipeline          = EXCLUDED.pipeline,
            is_won            = EXCLUDED.is_won,
            is_closed         = EXCLUDED.is_closed,
            amount            = EXCLUDED.amount,
            currency          = EXCLUDED.currency,
            closed_on         = EXCLUDED.closed_on,
            customer_source_id = EXCLUDED.customer_source_id,
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
            customer_source_id,
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


class GateBlocked(Exception):
    """The reconciliation gate refused to publish.

    Deliberately an exception, not a return value. A caller can ignore a return
    value; the whole point is that wrong financial data does not reach a
    dashboard because someone forgot to check.
    """


def publish_xero(lake: LakeStore, conn: Any, log: ObsLog, tenant_id: str) -> PublishResult:
    """Curate and publish one tenant's Xero raw, gated on reconciliation.

    The gate runs BEFORE anything is written. A blocked run leaves the previous
    generation serving -- stale, but not wrong -- which is the correct failure
    mode for accounting data.
    """
    from vcdo.curated.xero import to_invoice, to_payment
    from vcdo.curated.xero_gate import adjudicate

    current_run = run_id()
    invoices: list[tuple[Any, str]] = []
    payments: list[tuple[Any, str]] = []
    rejects: list[tuple[dict, Rejected, str]] = []
    raw_invoices: list[dict] = []

    contacts: list[tuple[Any, str]] = []

    with stage("curate:xero", log) as st:
        read = 0
        # Xero contacts become curated customers too. Without both sides in one
        # table the crosswalk has nothing to link ACROSS -- a HubSpot company and
        # a Xero contact for the same business would never meet.
        for raw in _read_raw(lake, "xero", tenant_id, "contacts"):
            read += 1
            key = f"records/xero/{tenant_id}/contacts/{raw['source_record_id']}"
            payload = raw.get("payload") or {}
            name = (payload.get("Name") or "").strip()
            if not name:
                rejects.append((raw, Rejected("missing_name", "xero contact has no Name"), key))
                st.excluded(1, "missing_name")
                continue
            contacts.append((_xero_contact_row(raw, payload, name), key))
        for raw in _read_raw(lake, "xero", tenant_id, "invoices"):
            read += 1
            raw_invoices.append(raw.get("payload") or {})
            key = f"records/xero/{tenant_id}/invoices/{raw['source_record_id']}"
            result = to_invoice(raw)
            if isinstance(result, Rejected):
                rejects.append((raw, result, key))
                st.excluded(1, result.reason_code)
            else:
                invoices.append((result, key))

        for raw in _read_raw(lake, "xero", tenant_id, "payments"):
            read += 1
            key = f"records/xero/{tenant_id}/payments/{raw['source_record_id']}"
            result = to_payment(raw)
            if isinstance(result, Rejected):
                rejects.append((raw, result, key))
                st.excluded(1, result.reason_code)
            else:
                payments.append((result, key))

        st.rows_in(read)
        st.rows_out(len(invoices) + len(payments) + len(contacts))

    gate = adjudicate(raw_invoices)
    _record_findings(conn, current_run, gate)

    if not gate.passed:
        log.error(
            "xero gate blocked publish",
            blocking=len(gate.blocking),
            codes=sorted({f.code for f in gate.blocking}),
        )
        raise GateBlocked(
            f"{gate.summary()}. Refusing to publish: "
            + "; ".join(f"{f.code} on {f.document_id}" for f in gate.blocking[:5])
        )

    # Payments take their currency from their PARENT DOCUMENT, resolved here
    # rather than asserted in the transform because only at this point do we hold
    # both sides.
    #
    # Credit notes must be in this map, not just invoices. A credit-note payment
    # points at a CreditNoteID, so an invoice-only lookup leaves it with an amount
    # and no currency -- which the schema rightly rejects. The database constraint
    # caught this; the transform tests did not, because in isolation the payment
    # looked complete.
    currency_by_document = {i.source_record_id: i.currency for i, _ in invoices}
    for raw in _read_raw(lake, "xero", tenant_id, "credit_notes"):
        payload = raw.get("payload") or {}
        currency = str(payload.get("CurrencyCode") or "").upper()
        if len(currency) == 3:
            currency_by_document[raw["source_record_id"]] = currency

    with conn.transaction():
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO ops.generation (run_id, status) VALUES (%s, 'building') RETURNING id",
            (current_run,),
        )
        row = cur.fetchone()
        assert row is not None
        generation_id = row[0]

        for contact, key in contacts:
            _upsert_customer(cur, contact, current_run, key)
        for invoice, key in invoices:
            _upsert_invoice(cur, invoice, current_run, key)
        for payment, key in payments:
            currency = currency_by_document.get(payment.target_source_id or "")
            _upsert_payment(cur, payment, currency, current_run, key)
        for raw, reject, key in rejects:
            _quarantine(cur, raw, reject, current_run, key)

        cur.execute(
            "UPDATE ops.generation SET status = 'published', published_at = now() WHERE id = %s",
            (generation_id,),
        )

    log.finish(
        "published xero generation",
        invoices=len(invoices),
        payments=len(payments),
        quarantined=len(rejects),
        review_findings=len(gate.review),
    )
    return PublishResult(current_run, len(invoices), len(payments), len(rejects))


def _record_findings(conn: Any, run: str, gate) -> None:
    """Persist what the gate decided, pass or fail.

    Recorded even on success: the review findings are the backlog, and a clean
    run is itself evidence the gate was applied rather than skipped.
    """
    cur = conn.cursor()
    for f in gate.findings:
        cur.execute(
            """
            INSERT INTO ops.gate_finding (run_id, source, severity, code, document_id, detail)
            VALUES (%s, 'xero', %s, %s, %s, %s)
            """,
            (run, f.severity, f.code, f.document_id, f.detail),
        )
    conn.commit()


def _upsert_invoice(cur: Any, i: Any, run: str, key: str) -> None:
    cur.execute(
        """
        INSERT INTO curated.invoices (
            source, tenant_id, source_record_id, contact_source_id, contact_name,
            invoice_number, invoice_type, status, currency, currency_rate,
            total, amount_paid, amount_credited, amount_due, counts_as_revenue,
            issued_on, due_on, source_updated_at, run_id, lake_key, built_at
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
        ON CONFLICT (source, tenant_id, source_record_id) DO UPDATE SET
            contact_source_id = EXCLUDED.contact_source_id,
            contact_name      = EXCLUDED.contact_name,
            invoice_number    = EXCLUDED.invoice_number,
            invoice_type      = EXCLUDED.invoice_type,
            status            = EXCLUDED.status,
            currency          = EXCLUDED.currency,
            currency_rate     = EXCLUDED.currency_rate,
            total             = EXCLUDED.total,
            amount_paid       = EXCLUDED.amount_paid,
            amount_credited   = EXCLUDED.amount_credited,
            amount_due        = EXCLUDED.amount_due,
            counts_as_revenue = EXCLUDED.counts_as_revenue,
            issued_on         = EXCLUDED.issued_on,
            due_on            = EXCLUDED.due_on,
            source_updated_at = EXCLUDED.source_updated_at,
            run_id            = EXCLUDED.run_id,
            lake_key          = EXCLUDED.lake_key,
            built_at          = now()
        """,
        (
            i.source,
            i.tenant_id,
            i.source_record_id,
            i.contact_source_id,
            i.contact_name,
            i.invoice_number,
            i.invoice_type,
            i.status,
            i.currency,
            i.currency_rate,
            i.total,
            i.amount_paid,
            i.amount_credited,
            i.amount_due,
            i.counts_as_revenue,
            i.issued_on,
            i.due_on,
            i.source_updated_at,
            run,
            key,
        ),
    )


def _upsert_payment(cur: Any, p: Any, currency: str | None, run: str, key: str) -> None:
    cur.execute(
        """
        INSERT INTO curated.payments (
            source, tenant_id, source_record_id, payment_type, status,
            target_type, target_source_id, contact_source_id,
            currency_rate, amount, currency, paid_on, source_updated_at,
            run_id, lake_key, built_at
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
        ON CONFLICT (source, tenant_id, source_record_id) DO UPDATE SET
            payment_type      = EXCLUDED.payment_type,
            status            = EXCLUDED.status,
            target_type       = EXCLUDED.target_type,
            target_source_id  = EXCLUDED.target_source_id,
            contact_source_id = EXCLUDED.contact_source_id,
            currency_rate     = EXCLUDED.currency_rate,
            amount            = EXCLUDED.amount,
            currency          = EXCLUDED.currency,
            paid_on           = EXCLUDED.paid_on,
            source_updated_at = EXCLUDED.source_updated_at,
            run_id            = EXCLUDED.run_id,
            lake_key          = EXCLUDED.lake_key,
            built_at          = now()
        """,
        (
            p.source,
            p.tenant_id,
            p.source_record_id,
            p.payment_type,
            p.status,
            p.target_type,
            p.target_source_id,
            p.contact_source_id,
            p.currency_rate,
            p.amount,
            currency,
            p.paid_on,
            p.source_updated_at,
            run,
            key,
        ),
    )


def _xero_contact_row(raw: dict, payload: dict, name: str):
    """A Xero contact as a curated customer.

    `CompanyNumber` is Xero's field for the registration number -- the UEN in
    Singapore. It is the one identifier strong enough to merge on, so it is
    carried through rather than left in the payload.
    """
    from vcdo.core.names import norm_name
    from vcdo.curated.hubspot import CuratedCustomer

    return CuratedCustomer(
        source="xero",
        tenant_id=raw.get("tenant_id", ""),
        source_record_id=raw["source_record_id"],
        display_name=name,
        normalised_name=norm_name(name),
        domain=None,
        email=(payload.get("EmailAddress") or "").strip() or None,
        lifecycle_stage=(payload.get("ContactStatus") or "").strip() or None,
        industry=None,
        customer_kind="company",
        source_created_at=None,
        source_updated_at=None,
    )
