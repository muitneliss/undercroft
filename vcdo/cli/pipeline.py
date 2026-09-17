"""Pipeline verbs: migrate, seed, slice.

Thin wiring. The logic lives in :mod:`vcdo.lake.ingest` and
:mod:`vcdo.curated.load`, which are testable without a database or an object
store. This module's only job is to construct the real ones and report.
"""

from __future__ import annotations

from pathlib import Path

from vcdo.core.config import Config
from vcdo.core.obs_log import ObsLog
from vcdo.lake.ingest import land
from vcdo.lake.s3 import from_config
from vcdo.lake.store import LakeStore
from vcdo.sources.hubspot import HubSpotSource
from vcdo.sources.xero import XeroSource

__all__ = ["migrate", "seed", "run_slice"]

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"

#: Which HubSpot portal the fixtures represent. A real portal id in live mode --
#: the legacy repo's ingest aborts before any CRM read if the connected portal
#: is not the expected one, because syncing the wrong tenant into a shared lake
#: is very hard to unpick afterwards.
FIXTURE_TENANT = "portal-fixture"


def _connect(cfg: Config):
    import psycopg

    return psycopg.connect(cfg.postgres_dsn, connect_timeout=10)


def migrate(cfg: Config, log: ObsLog) -> int:
    """Apply SQL migrations in filename order.

    Each file is idempotent (``CREATE ... IF NOT EXISTS``) and wrapped in its own
    transaction, so re-running is safe and a failure leaves no partial schema.
    """
    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        raise RuntimeError(f"no migrations found in {MIGRATIONS}")

    with _connect(cfg) as conn:
        for path in files:
            conn.execute(path.read_text())
            log.write("info", "migrate", f"applied {path.name}", migration=path.name)
        _set_bi_password(conn, log)
        conn.commit()
    return len(files)


def _set_bi_password(conn, log: ObsLog) -> None:
    """Give the BI role its password, from the environment.

    Kept out of the migration file because passwords do not belong in git. Until
    this runs the role exists but cannot authenticate, which is the safe order:
    a half-applied migration leaves no usable account rather than an open one.
    """
    import os

    from psycopg import sql

    password = os.environ.get("VCDO_METABASE_RO_PASSWORD", "").strip()
    if not password:
        log.write(
            "warning",
            "migrate",
            "VCDO_METABASE_RO_PASSWORD unset; metabase_ro cannot log in until it is set",
        )
        return
    # Composed, never interpolated. ALTER ROLE is DDL and cannot take a bind
    # parameter, so the password is quoted as a literal by the driver.
    conn.execute(sql.SQL("ALTER ROLE metabase_ro PASSWORD {}").format(sql.Literal(password)))
    log.write("info", "migrate", "metabase_ro password set from environment")


def _lake(cfg: Config) -> LakeStore:
    return LakeStore(from_config(cfg))


def _source(cfg: Config) -> HubSpotSource:
    return HubSpotSource(
        tenant_id=FIXTURE_TENANT,
        mode=cfg.mode_for("hubspot"),
        fixtures_dir=cfg.fixtures_dir,
    )


def _sources(cfg: Config) -> list:
    """Every configured source. Mode is resolved per source, so one can be live
    while the rest are mocked."""
    return [
        _source(cfg),
        XeroSource(
            tenant_id=FIXTURE_TENANT,
            mode=cfg.mode_for("xero"),
            fixtures_dir=cfg.fixtures_dir,
        ),
    ]


def seed(cfg: Config, log: ObsLog) -> dict[str, int]:
    """Land every configured source into the raw lake."""
    lake = _lake(cfg)
    landed = {}
    for source in _sources(cfg):
        for entity in source.entities():
            result = land(source, entity, lake, log)
            landed[f"{source.name}/{entity}"] = result.read
    return landed


def run_slice(cfg: Config, log: ObsLog) -> dict[str, int]:
    """The full vertical slice: raw -> curated -> a dashboard query."""
    from vcdo.curated.load import flush_run_ledger, publish_hubspot, publish_xero

    migrate(cfg, log)
    landed = seed(cfg, log)

    lake = _lake(cfg)
    with _connect(cfg) as conn:
        published = publish_hubspot(lake, conn, log, FIXTURE_TENANT)
        # Xero publishes behind its reconciliation gate; a GateBlocked here
        # propagates and fails the run rather than publishing wrong figures.
        xero = publish_xero(lake, conn, log, FIXTURE_TENANT)
        # The ledger is projected AFTER publish, so it records what actually
        # happened including the publish stage itself.
        flush_run_ledger(conn, cfg.log_dir, published.run_id)
        conn.commit()

        # The dashboard query, run as part of the slice. A pipeline that loads
        # rows nobody has queried has not been shown to work end to end.
        row = conn.execute(
            """
            SELECT count(*)                                  AS deals,
                   count(*) FILTER (WHERE is_won)            AS won,
                   coalesce(sum(amount) FILTER (WHERE is_won), 0) AS won_amount,
                   count(DISTINCT currency)                  AS currencies
            FROM curated.deals
            """
        ).fetchone()
        assert row is not None
        deals, won, won_amount, currencies = row

    return {
        "landed": sum(landed.values()),
        "customers": published.customers,
        "deals": published.deals,
        "invoices": xero.customers,
        "payments": xero.deals,
        "quarantined": published.quarantined + xero.quarantined,
        "won_deals": won,
        "won_amount": won_amount,
        "currencies": currencies,
    }
