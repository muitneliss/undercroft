"""Failure injection: the platform must fail in the ways it claims to.

Every check here is a failure mode that has a *plausible-looking* wrong outcome.
Auth expiring and producing an empty table. A malformed record vanishing. A
crashed transform leaving half a generation published. None of these announce
themselves; each looks like a quiet day.
"""

import json
import os
import uuid
from pathlib import Path

import pytest

from vcdo.core.obs_log import ObsLog
from vcdo.core.run_ledger import STREAM, stage
from vcdo.lake.ingest import land
from vcdo.lake.store import LakeStore
from vcdo.sources.base import SourceError
from vcdo.sources.hubspot import HubSpotSource

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def stack(tmp_path):
    from vcdo.core.config import load

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

    tenant = f"inject-{uuid.uuid4().hex[:8]}"
    yield cfg, LakeStore(store), ObsLog("inject", log_dir=tmp_path), conn, tenant, store, tmp_path

    for table in ("customers", "deals", "invoices", "payments"):
        conn.execute(f"DELETE FROM curated.{table} WHERE tenant_id = %s", (tenant,))
    conn.commit()
    conn.close()
    for key in list(store.list(f"records/hubspot/{tenant}/")):
        store.delete(key)


# -- auth / source failures --------------------------------------------------


def test_a_source_that_cannot_authenticate_fails_the_run(stack):
    """The HubSpot-403 failure: a 403 silently produced an empty staging table,
    which published as a successful run with zero rows -- indistinguishable from
    a customer who genuinely has no data."""
    cfg, lake, log, conn, tenant, _, tmp_path = stack

    source = HubSpotSource(tenant_id=tenant, mode="mock", fixtures_dir=str(tmp_path / "nope"))

    with pytest.raises(SourceError, match="no hubspot fixture"):
        land(source, "companies", lake, log)


def test_an_empty_stream_is_refused_rather_than_published(stack):
    """Zero rows where the inventory expects data is the same defect wearing a
    different hat."""
    cfg, lake, log, conn, tenant, _, tmp_path = stack

    empty = tmp_path / "empty"
    (empty / "hubspot").mkdir(parents=True)
    (empty / "hubspot" / "companies.json").write_text(json.dumps({"results": []}))

    source = HubSpotSource(tenant_id=tenant, mode="mock", fixtures_dir=str(empty))

    with pytest.raises(SourceError, match="yielded no records"):
        land(source, "companies", lake, log)


def test_a_malformed_payload_is_quarantined_with_its_payload(stack):
    """A rejected row that exists only in a log cannot be re-examined or counted."""
    from vcdo.curated.load import publish_hubspot

    cfg, lake, log, conn, tenant, _, tmp_path = stack

    broken = tmp_path / "broken"
    (broken / "hubspot").mkdir(parents=True)
    data = json.loads((ROOT / "fixtures" / "hubspot" / "companies.json").read_text())
    data["results"][0]["properties"]["name"] = "   "  # a company with no readable name
    (broken / "hubspot" / "companies.json").write_text(json.dumps(data))
    # Every entity the source declares, not a hand-listed subset -- adding an
    # entity should not silently break an unrelated test.
    for name in ("contacts", "deals", "associations"):
        (broken / "hubspot" / f"{name}.json").write_text(
            (ROOT / "fixtures" / "hubspot" / f"{name}.json").read_text()
        )

    source = HubSpotSource(tenant_id=tenant, mode="mock", fixtures_dir=str(broken))
    for entity in source.entities():
        land(source, entity, lake, log)

    result = publish_hubspot(lake, conn, log, tenant)
    assert result.quarantined == 1

    row = conn.execute(
        """
        SELECT reason_code, payload IS NOT NULL FROM dq.quarantine
        WHERE run_id = %s AND reason_code = 'missing_name'
        """,
        (result.run_id,),
    ).fetchone()
    assert row is not None
    assert row[0] == "missing_name"
    assert row[1] is True, "the original payload must be retained for re-examination"


# -- transform crash ---------------------------------------------------------


def test_a_crash_mid_publish_leaves_nothing_half_written(stack):
    """Publishing is one transaction. A partial generation is worse than none:
    it looks like data."""
    import psycopg

    cfg, lake, log, conn, tenant, _, _ = stack

    before = conn.execute(
        "SELECT count(*) FROM curated.customers WHERE tenant_id = %s", (tenant,)
    ).fetchone()[0]

    with pytest.raises(psycopg.errors.UndefinedColumn), conn.transaction():
        conn.execute(
            """
            INSERT INTO curated.customers
                (source, tenant_id, source_record_id, display_name, customer_kind, run_id, lake_key)
            VALUES ('hubspot', %s, 'crash-1', 'Partial', 'company', 'r', 'k')
            """,
            (tenant,),
        )
        conn.execute("SELECT no_such_column FROM curated.customers")

    after = conn.execute("SELECT count(*) FROM curated.customers WHERE tenant_id = %s", (tenant,)).fetchone()[
        0
    ]
    assert after == before, "a crashed transaction must leave no rows behind"


# -- accounting ---------------------------------------------------------------


def test_rows_lost_without_a_decision_are_surfaced_in_the_ledger(stack):
    """The quiet failure: a smaller month that nobody can explain."""
    cfg, lake, log, conn, tenant, _, tmp_path = stack

    with stage("inject:lossy", log) as st:
        st.rows_in(100)
        st.rows_out(88)  # 12 vanish with no exclusion reason

    ledger = [
        json.loads(line) for line in (tmp_path / f"{STREAM}.jsonl").read_text().splitlines() if line.strip()
    ][-1]

    assert ledger["unaccounted"] == 12
    assert ledger["level"] == "warning"


def test_a_deliberate_exclusion_does_not_look_like_loss(stack):
    """The guard must stay quiet when rows are dropped ON PURPOSE, or it gets
    ignored."""
    cfg, lake, log, conn, tenant, _, tmp_path = stack

    with stage("inject:clean", log) as st:
        st.rows_in(100)
        st.rows_out(88)
        st.excluded(12, "voided_invoice")

    ledger = [
        json.loads(line) for line in (tmp_path / f"{STREAM}.jsonl").read_text().splitlines() if line.strip()
    ][-1]

    assert ledger["unaccounted"] == 0
    assert ledger["level"] == "info"


# -- object store outage ------------------------------------------------------


def test_an_unreachable_object_store_fails_loudly(stack):
    """Not an empty result. A lake read that returns nothing on an outage would
    publish an empty generation over good data."""
    from vcdo.lake.s3 import S3ObjectStore

    dead = S3ObjectStore(
        "vcc-raw",
        endpoint_url="http://127.0.0.1:1",  # nothing listens here
        access_key="x",
        secret_key="y",
    )
    lake = LakeStore(dead)

    with pytest.raises(Exception) as excinfo:
        lake.put("hubspot/t/companies/1", b"{}", run_id="r")

    assert "EndpointConnectionError" in type(excinfo.value).__name__ or "Connect" in str(excinfo.value)
