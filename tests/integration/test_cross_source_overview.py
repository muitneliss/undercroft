"""Cross-source figures must be attributable, or absent.

REGRESSION: the first version of curated.customer_commercial_overview had no
deal->customer edge to join on, so it joined on `source` alone -- a cartesian
product that credited every contact with every company's deals. It produced 28
rows where 4 were real. Every individual row looked plausible; the totals were
fabricated.

That is the exact shape of failure the "never guess" rule exists for, and the
only thing that caught it was reading the output.
"""

import os
import uuid
from pathlib import Path

import pytest

from vcdo.core.obs_log import ObsLog
from vcdo.lake.ingest import land
from vcdo.lake.store import LakeStore
from vcdo.sources.hubspot import HubSpotSource
from vcdo.sources.xero import XeroSource

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def published(tmp_path):
    from vcdo.core.config import load
    from vcdo.curated.link import link_entities
    from vcdo.curated.load import publish_hubspot, publish_xero

    cfg = load(dict(os.environ))
    try:
        import psycopg

        from vcdo.lake.s3 import from_config

        store = from_config(cfg)
        store.put("itest/probe", b"x")
        store.delete("itest/probe")
        conn = psycopg.connect(cfg.postgres_dsn, connect_timeout=5)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"stack not reachable: {type(exc).__name__}")

    for migration in sorted((ROOT / "migrations").glob("*.sql")):
        conn.execute(migration.read_text())
    conn.commit()

    tenant = f"xsrc-{uuid.uuid4().hex[:8]}"
    lake, log = LakeStore(store), ObsLog("xsrc", log_dir=tmp_path)

    for source in (
        HubSpotSource(tenant_id=tenant, mode="mock", fixtures_dir=str(ROOT / "fixtures")),
        XeroSource(tenant_id=tenant, mode="mock", fixtures_dir=str(ROOT / "fixtures")),
    ):
        for entity in source.entities():
            land(source, entity, lake, log)

    publish_hubspot(lake, conn, log, tenant)
    publish_xero(lake, conn, log, tenant)
    link_entities(conn, log, tenant)

    yield conn, tenant

    for table in ("customers", "deals", "invoices", "payments"):
        conn.execute(f"DELETE FROM curated.{table} WHERE tenant_id = %s", (tenant,))
    conn.commit()
    conn.close()
    for prefix in (f"records/hubspot/{tenant}/", f"records/xero/{tenant}/"):
        for key in list(store.list(prefix)):
            store.delete(key)


def overview(conn, tenant):
    return list(
        conn.execute(
            """
            SELECT customer, currency, period, deals_won, deal_value_won,
                   invoices, invoiced
            FROM curated.customer_commercial_overview
            WHERE tenant_id = %s
            """,
            (tenant,),
        )
    )


def test_a_deal_is_credited_to_one_customer_not_all_of_them(published):
    """The regression. Four deals across four companies must never produce a
    row per (deal x customer)."""
    conn, tenant = published

    rows = overview(conn, tenant)

    assert len(rows) <= 6, f"expected a handful of attributable rows, got {len(rows)} -- cartesian join?"
    for row in rows:
        if row[3]:
            assert row[3] <= 1, "a single fixture deal cannot be won more than once by one customer"


def test_a_contact_person_is_never_credited_with_company_deals(published):
    """Contacts are people; the deal belongs to the company."""
    conn, tenant = published

    people = {"Anh Nguyen", "Binh Tran", "Chi Le", "Dung Pham", "Dung"}
    credited = {r[0] for r in overview(conn, tenant) if r[3]}

    assert not (credited & people), f"contacts credited with deals: {credited & people}"


def test_deal_value_and_invoiced_are_separate_columns(published):
    """A deal is an expectation and an invoice is a claim on money. Summing them
    double-counts one commercial event as it progresses."""
    conn, tenant = published

    columns = [
        d[0] for d in conn.execute("SELECT * FROM curated.customer_commercial_overview LIMIT 0").description
    ]

    assert "deal_value_won" in columns
    assert "invoiced" in columns
    assert not any(c in columns for c in ("total_value", "combined", "revenue"))


def test_currencies_stay_on_separate_rows(published):
    """A USD invoice and an SGD deal for one customer are two rows, never a total."""
    conn, tenant = published

    alpha = [r for r in overview(conn, tenant) if r[0] and "Alpha" in r[0]]

    assert {r[1] for r in alpha} >= {"USD", "SGD"}


def test_an_unattributed_deal_is_visible_rather_than_absent(published):
    """A deal with no association is missing from every customer figure, and that
    absence is silent unless it is surfaced."""
    conn, tenant = published
    conn.execute(
        """
        INSERT INTO curated.deals
            (source, tenant_id, source_record_id, deal_name, is_won, amount, currency,
             closed_on, run_id, lake_key)
        VALUES ('hubspot', %s, 'orphan-1', 'No association', true, 999.00, 'SGD',
                '2026-05-01', 'r', 'k')
        """,
        (tenant,),
    )
    conn.commit()

    orphans = conn.execute(
        "SELECT count(*) FROM curated.unattributed_deals WHERE tenant_id = %s", (tenant,)
    ).fetchone()[0]

    assert orphans == 1
