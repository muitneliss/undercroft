"""A backup nobody has restored is a hypothesis.

These restore into a genuinely separate database and check the rows came back,
rather than asserting a file was written. The difference is the whole point:
an empty dump file passes the second kind of test and fails the first.
"""

import os
import uuid

import pytest

from vcdo.cli.backup import BACKUP_SCHEMAS, dump, restore

pytestmark = pytest.mark.integration


@pytest.fixture
def databases(tmp_path):
    """A source database with rows, and an empty target to restore into."""
    dsn = os.environ.get("VCDO_POSTGRES_DSN", "")
    try:
        import psycopg
        from psycopg import sql

        conn = psycopg.connect(dsn, connect_timeout=5)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"postgres not reachable: {type(exc).__name__}")

    if not _has_pg_tools():
        pytest.skip("pg_dump/pg_restore not on PATH")

    target = f"vcdo_restore_{uuid.uuid4().hex[:8]}"
    admin = psycopg.connect(dsn, autocommit=True, connect_timeout=5)
    admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(target)))

    target_dsn = dsn.rsplit("/", 1)[0] + "/" + target
    tenant = f"backup-{uuid.uuid4().hex[:8]}"

    yield conn, target_dsn, tenant, tmp_path

    conn.execute("DELETE FROM curated.customers WHERE tenant_id = %s", (tenant,))
    conn.commit()
    conn.close()
    admin.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(target)))
    admin.close()


def _has_pg_tools() -> bool:
    import shutil

    return bool(shutil.which("pg_dump") and shutil.which("pg_restore"))


def _seed(conn, tenant):
    conn.execute(
        """
        INSERT INTO curated.customers
            (source, tenant_id, source_record_id, display_name, normalised_name,
             customer_kind, run_id, lake_key)
        VALUES ('hubspot', %s, 'backup-1', 'Synthetic Alpha Pte Ltd', 'syntheticalpha',
                'company', 'run-backup', 'records/hubspot/x/companies/backup-1')
        ON CONFLICT (source, tenant_id, source_record_id) DO NOTHING
        """,
        (tenant,),
    )
    conn.commit()


def test_a_dump_is_produced_and_is_not_empty(databases):
    """An empty dump file is the failure that looks like success: green job,
    file exists, restore finds nothing."""
    conn, _, tenant, tmp_path = databases
    _seed(conn, tenant)

    result = dump(os.environ["VCDO_POSTGRES_DSN"], tmp_path)

    assert result.path.exists()
    assert result.bytes > 0
    assert result.schemas == BACKUP_SCHEMAS


def test_rows_come_back_after_a_restore_into_a_clean_database(databases):
    """The actual promise. Everything else is a proxy for this."""
    import psycopg

    conn, target_dsn, tenant, tmp_path = databases
    _seed(conn, tenant)

    result = dump(os.environ["VCDO_POSTGRES_DSN"], tmp_path)
    restore(target_dsn, result.path, clean=False)

    with psycopg.connect(target_dsn) as restored:
        row = restored.execute(
            "SELECT display_name, normalised_name FROM curated.customers "
            "WHERE tenant_id = %s AND source_record_id = 'backup-1'",
            (tenant,),
        ).fetchone()

    assert row is not None, "the restored database has no trace of the backed-up row"
    assert row[0] == "Synthetic Alpha Pte Ltd"
    assert row[1] == "syntheticalpha"


def test_the_restored_database_keeps_its_constraints(databases):
    """A restore that brings rows but drops constraints leaves a database that
    accepts data the original would have refused -- and nobody notices until
    something wrong gets in."""
    import psycopg

    conn, target_dsn, tenant, tmp_path = databases
    _seed(conn, tenant)
    result = dump(os.environ["VCDO_POSTGRES_DSN"], tmp_path)
    restore(target_dsn, result.path, clean=False)

    with psycopg.connect(target_dsn) as restored, pytest.raises(psycopg.errors.CheckViolation):
        restored.execute(
            """
            INSERT INTO curated.deals (source, tenant_id, source_record_id, amount, run_id, lake_key)
            VALUES ('hubspot', 'x', 'no-currency', 100.00, 'r', 'k')
            """
        )


def test_the_restored_database_keeps_its_grain(databases):
    """The primary key is what makes the load idempotent. A restore without it
    would let a re-run duplicate every row."""
    import psycopg

    conn, target_dsn, tenant, tmp_path = databases
    _seed(conn, tenant)
    result = dump(os.environ["VCDO_POSTGRES_DSN"], tmp_path)
    restore(target_dsn, result.path, clean=False)

    with psycopg.connect(target_dsn) as restored, pytest.raises(psycopg.errors.UniqueViolation):
        restored.execute(
            """
            INSERT INTO curated.customers
                (source, tenant_id, source_record_id, display_name, customer_kind, run_id, lake_key)
            VALUES ('hubspot', %s, 'backup-1', 'Duplicate', 'company', 'r', 'k')
            """,
            (tenant,),
        )
