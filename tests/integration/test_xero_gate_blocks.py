"""The gate must fail closed against a real database.

A gate nobody has watched block is not known to work. This deliberately corrupts
a fixture, runs the real publish path, and asserts that nothing reached the
curated tables — the previous generation keeps serving, stale rather than wrong.
"""

import json
import os
import uuid
from pathlib import Path

import pytest

from vcdo.core.config import load
from vcdo.core.obs_log import ObsLog
from vcdo.lake.ingest import land
from vcdo.lake.store import LakeStore
from vcdo.sources.xero import XeroSource

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def stack(tmp_path):
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

    tenant = f"itest-{uuid.uuid4().hex[:8]}"
    yield cfg, LakeStore(store), ObsLog("itest", log_dir=tmp_path), conn, tenant, store

    for table in ("invoices", "payments"):
        conn.execute(f"DELETE FROM curated.{table} WHERE tenant_id = %s", (tenant,))
    conn.commit()
    conn.close()
    for key in list(store.list(f"records/xero/{tenant}/")):
        store.delete(key)


def _seed(cfg, lake, log, tenant, fixtures: Path):
    source = XeroSource(tenant_id=tenant, mode="mock", fixtures_dir=str(fixtures))
    for entity in source.entities():
        land(source, entity, lake, log)


def test_sound_data_publishes(stack):
    from vcdo.curated.load import publish_xero

    cfg, lake, log, conn, tenant, _ = stack
    _seed(cfg, lake, log, tenant, ROOT / "fixtures")

    result = publish_xero(lake, conn, log, tenant)

    assert result.customers == 4  # invoices
    assert result.deals == 4  # payments


def test_an_invoice_that_does_not_reconcile_blocks_the_whole_publish(stack, tmp_path):
    """Not a partial load. Nothing reaches curated, so the previous generation
    keeps serving -- stale, not wrong."""
    from vcdo.curated.load import GateBlocked, publish_xero

    cfg, lake, log, conn, tenant, _ = stack

    # Corrupt one invoice: claim a total that its paid/credited/due cannot make up.
    broken = tmp_path / "fixtures"
    (broken / "xero").mkdir(parents=True)
    for name in ("invoices", "payments", "credit_notes", "contacts"):
        data = json.loads((ROOT / "fixtures" / "xero" / f"{name}.json").read_text())
        if name == "invoices":
            data["Invoices"][0]["Total"] = 175.00  # paid 100 + credited 0 + due 0
        (broken / "xero" / f"{name}.json").write_text(json.dumps(data))

    _seed(cfg, lake, log, tenant, broken)

    with pytest.raises(GateBlocked, match="invoice_does_not_reconcile"):
        publish_xero(lake, conn, log, tenant)

    published = conn.execute(
        "SELECT count(*) FROM curated.invoices WHERE tenant_id = %s", (tenant,)
    ).fetchone()[0]
    assert published == 0, "a blocked gate must publish nothing at all"


def test_a_blocked_run_records_why(stack, tmp_path):
    """'The gate blocked' is not actionable; 'invoice X is off by 75.00' is."""
    from vcdo.curated.load import GateBlocked, publish_xero

    cfg, lake, log, conn, tenant, _ = stack

    broken = tmp_path / "fixtures"
    (broken / "xero").mkdir(parents=True)
    for name in ("invoices", "payments", "credit_notes", "contacts"):
        data = json.loads((ROOT / "fixtures" / "xero" / f"{name}.json").read_text())
        if name == "invoices":
            data["Invoices"][0]["Total"] = 175.00
        (broken / "xero" / f"{name}.json").write_text(json.dumps(data))

    _seed(cfg, lake, log, tenant, broken)
    with pytest.raises(GateBlocked):
        publish_xero(lake, conn, log, tenant)

    findings = conn.execute(
        """
        SELECT code, document_id, detail FROM ops.gate_finding
        WHERE severity = 'block' ORDER BY recorded_at DESC LIMIT 1
        """
    ).fetchone()
    assert findings is not None
    assert findings[0] == "invoice_does_not_reconcile"
    assert "175" in findings[2]


def test_revenue_never_mixes_currencies(stack):
    """USD and SGD invoices must occupy separate rows, never a combined total."""
    from vcdo.curated.load import publish_xero

    cfg, lake, log, conn, tenant, _ = stack
    _seed(cfg, lake, log, tenant, ROOT / "fixtures")
    publish_xero(lake, conn, log, tenant)

    rows = conn.execute(
        """
        SELECT currency, sum(invoiced) FROM curated.revenue_by_customer_period
        WHERE tenant_id = %s GROUP BY currency ORDER BY currency
        """,
        (tenant,),
    ).fetchall()

    assert {r[0] for r in rows} == {"SGD", "USD"}


def test_a_supplier_bill_is_absent_from_revenue(stack):
    """ACCPAY is money we owe. Counting it would inflate the top line."""
    from vcdo.curated.load import publish_xero

    cfg, lake, log, conn, tenant, _ = stack
    _seed(cfg, lake, log, tenant, ROOT / "fixtures")
    publish_xero(lake, conn, log, tenant)

    bills = conn.execute(
        """
        SELECT count(*) FROM curated.invoices
        WHERE tenant_id = %s AND invoice_type = 'ACCPAY' AND counts_as_revenue
        """,
        (tenant,),
    ).fetchone()[0]
    assert bills == 0

    retained = conn.execute(
        "SELECT count(*) FROM curated.invoices WHERE tenant_id = %s AND invoice_type = 'ACCPAY'",
        (tenant,),
    ).fetchone()[0]
    assert retained == 1, "the bill is excluded from revenue but still retained"
