"""The vertical slice must be reproducible from raw alone.

This is the property the whole architecture rests on: everything in Postgres is a
projection that may be dropped and rebuilt, and rebuilding must produce identical
rows. If that fails, a schema change or a transform fix stops being a backfill
and becomes a data rescue.

Skips when the stack is not running, so the gate stays green offline.
"""

import hashlib
import os
import uuid
from pathlib import Path

import pytest

from vcdo.core.config import load
from vcdo.core.obs_log import ObsLog
from vcdo.lake.ingest import land
from vcdo.lake.store import LakeStore
from vcdo.sources.hubspot import HubSpotSource

pytestmark = pytest.mark.integration

FIXTURES = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "fixtures")


@pytest.fixture
def stack(tmp_path):
    """Real MinIO and Postgres, namespaced so parallel runs cannot collide."""
    cfg = load(dict(os.environ))
    try:
        import psycopg

        from vcdo.lake.s3 import from_config

        store = from_config(cfg)
        store.put("itest/probe", b"x")
        store.delete("itest/probe")
        conn = psycopg.connect(cfg.postgres_dsn, connect_timeout=5)
    except Exception as exc:  # noqa: BLE001 - unreachable stack means skip, not fail
        pytest.skip(f"stack not reachable: {type(exc).__name__}: {exc}")

    tenant = f"itest-{uuid.uuid4().hex[:8]}"
    lake = LakeStore(store)
    log = ObsLog("itest", log_dir=tmp_path)

    conn.execute(Path(_migration()).read_text())
    conn.commit()

    yield cfg, lake, log, conn, tenant

    conn.execute("DELETE FROM curated.customers WHERE tenant_id = %s", (tenant,))
    conn.execute("DELETE FROM curated.deals WHERE tenant_id = %s", (tenant,))
    conn.commit()
    conn.close()

    # Remove this tenant's lake objects too. Each test run uses a fresh tenant,
    # so without this the local MinIO accumulates a full copy of the fixtures
    # per run forever -- and a test suite that grows the dev environment without
    # bound eventually gets switched off.
    for key in list(store.list(f"records/hubspot/{tenant}/")):
        store.delete(key)


def _migration():
    here = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    return os.path.join(here, "migrations", "001_curated_core.sql")


def _fingerprint(conn, tenant):
    rows = list(
        conn.execute(
            """
            SELECT source, source_record_id, display_name, normalised_name, domain,
                   email, customer_kind, source_updated_at, lake_key
            FROM curated.customers WHERE tenant_id = %s ORDER BY source_record_id
            """,
            (tenant,),
        )
    ) + list(
        conn.execute(
            """
            SELECT source, source_record_id, deal_name, stage, is_won, is_closed,
                   amount, currency, closed_on, lake_key
            FROM curated.deals WHERE tenant_id = %s ORDER BY source_record_id
            """,
            (tenant,),
        )
    )
    return hashlib.sha256(repr(rows).encode()).hexdigest()


def _run(cfg, lake, log, conn, tenant):
    from vcdo.curated.load import publish_hubspot

    source = HubSpotSource(tenant_id=tenant, mode="mock", fixtures_dir=FIXTURES)
    for entity in source.entities():
        land(source, entity, lake, log)
    return publish_hubspot(lake, conn, log, tenant)


def test_the_slice_lands_curates_and_publishes(stack):
    cfg, lake, log, conn, tenant = stack

    result = _run(cfg, lake, log, conn, tenant)

    assert result.customers == 9  # 4 companies + 5 contacts
    assert result.deals == 4
    assert result.quarantined == 0


def test_rebuilding_from_raw_produces_identical_rows(stack):
    """Drop-and-rebuild must be a backfill, never a data rescue."""
    cfg, lake, log, conn, tenant = stack
    _run(cfg, lake, log, conn, tenant)
    first = _fingerprint(conn, tenant)

    conn.execute("DELETE FROM curated.customers WHERE tenant_id = %s", (tenant,))
    conn.execute("DELETE FROM curated.deals WHERE tenant_id = %s", (tenant,))
    conn.commit()

    _run(cfg, lake, log, conn, tenant)

    assert _fingerprint(conn, tenant) == first


def test_re_running_does_not_duplicate_rows(stack):
    cfg, lake, log, conn, tenant = stack
    _run(cfg, lake, log, conn, tenant)
    _run(cfg, lake, log, conn, tenant)

    customers = conn.execute(
        "SELECT count(*) FROM curated.customers WHERE tenant_id = %s", (tenant,)
    ).fetchone()[0]
    assert customers == 9


def test_the_dashboard_figure_matches_the_fixtures(stack):
    """3500 + 5000 won; the 1200.50 deal was lost and must not be counted."""
    cfg, lake, log, conn, tenant = stack
    _run(cfg, lake, log, conn, tenant)

    won, total, currencies = conn.execute(
        """
        SELECT count(*), coalesce(sum(amount), 0), count(DISTINCT currency)
        FROM curated.deals WHERE tenant_id = %s AND is_won
        """,
        (tenant,),
    ).fetchone()

    assert won == 2
    assert str(total) == "8500.0000"
    assert currencies == 1  # never silently mixing currencies


def test_a_deal_with_no_amount_stores_null_not_zero(stack):
    cfg, lake, log, conn, tenant = stack
    _run(cfg, lake, log, conn, tenant)

    amount, currency = conn.execute(
        "SELECT amount, currency FROM curated.deals WHERE tenant_id = %s AND source_record_id = '9003'",
        (tenant,),
    ).fetchone()

    assert amount is None
    assert currency is None


def test_every_row_carries_lineage_back_to_a_lake_object(stack):
    """Without the lake key, "where did this number come from" has no durable answer."""
    cfg, lake, log, conn, tenant = stack
    _run(cfg, lake, log, conn, tenant)

    orphans = conn.execute(
        """
        SELECT count(*) FROM curated.customers
        WHERE tenant_id = %s AND (lake_key IS NULL OR lake_key = '' OR run_id IS NULL)
        """,
        (tenant,),
    ).fetchone()[0]
    assert orphans == 0


def test_the_database_refuses_an_amount_without_a_currency(stack):
    """The constraint is the last line of defence if a transform regresses."""
    import psycopg

    cfg, lake, log, conn, tenant = stack

    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            """
            INSERT INTO curated.deals (source, tenant_id, source_record_id, amount, run_id, lake_key)
            VALUES ('hubspot', %s, 'bad-1', 100.00, 'r', 'k')
            """,
            (tenant,),
        )
    conn.rollback()
