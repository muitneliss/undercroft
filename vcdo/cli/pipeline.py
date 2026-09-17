"""Pipeline verbs: migrate, seed, slice.

Thin wiring. The logic lives in :mod:`vcdo.lake.ingest` and
:mod:`vcdo.curated.load`, which are testable without a database or an object
store. This module's only job is to construct the real ones and report.
"""

from __future__ import annotations

from pathlib import Path

from vcdo.core.config import SOURCES, Config
from vcdo.core.obs_log import ObsLog
from vcdo.lake.ingest import land, land_drive_pdfs, land_gmail_attachments
from vcdo.lake.s3 import from_config
from vcdo.lake.store import LakeStore
from vcdo.sources.base import SourceError
from vcdo.sources.drive import DriveSource
from vcdo.sources.gmail import GmailSource
from vcdo.sources.hubspot import HubSpotSource
from vcdo.sources.xero import XeroSource

__all__ = ["migrate", "seed", "run_slice"]

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"

#: The tenant the checked-in fixtures represent.
#:
#: Mock mode has no registry to read and needs none: the fixtures are the same
#: for everyone, and requiring a database row before the offline slice can run
#: would break the one path that works with no credentials and no stack --- which
#: is the path `make verify` and `make slice` depend on.
#:
#: In live mode this constant is not used at all. Sources are built from
#: ``ops.connection``, so the account each one reads is the customer's, not a
#: literal compiled into the pipeline.
FIXTURE_TENANT = "portal-fixture"
FIXTURE_MAILBOX = "mailbox-fixture@vietcham.example"


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


def _mock_sources(cfg: Config, tenant_id: str = FIXTURE_TENANT) -> list:
    """The fixture sources. No registry, no credentials, no database.

    The tenant is threaded through even here, and that is not cosmetic: the lake
    key is ``records/<source>/<tenant>/...`` and the publish step reads back by
    the same prefix. A mock source pinned to a constant while the publish looked
    for the requested tenant would land rows under one key, read another, and
    report a successful run that curated nothing.

    It also means a new tenant can be onboarded in mock mode and driven through
    the whole control plane on fixture data, which is the only way to exercise
    the UI before a real credential exists.
    """
    return [
        HubSpotSource(tenant_id=tenant_id, mode="mock", fixtures_dir=cfg.fixtures_dir),
        XeroSource(tenant_id=tenant_id, mode="mock", fixtures_dir=cfg.fixtures_dir),
        GmailSource(
            tenant_id=tenant_id,
            mailbox=FIXTURE_MAILBOX,
            mode="mock",
            fixtures_dir=cfg.fixtures_dir,
        ),
        DriveSource(tenant_id=tenant_id, mode="mock", fixtures_dir=cfg.fixtures_dir),
    ]


def _live_source(cfg: Config, conn, tenant_id: str, source: str):
    """Build one live source from its registry row, or say why it cannot be built.

    Every failure here is a refusal, never a degraded source. A source
    constructed without its credential does not read less data --- it reads none,
    and a run that lands zero rows looks exactly like a quiet month.
    """
    from vcdo.core.connections import access_token, get_connection

    connection = get_connection(conn, tenant_id, source)
    if connection is None:
        raise SourceError(f"{source} is live for tenant {tenant_id!r} but has no connection")
    if not connection.is_usable:
        raise SourceError(
            f"{source} connection for tenant {tenant_id!r} is {connection.status}, not connected"
        )

    config = connection.config or {}

    if source == "hubspot":
        return HubSpotSource(
            tenant_id=tenant_id,
            mode="live",
            fixtures_dir=cfg.fixtures_dir,
            token=access_token(conn, tenant_id, source),
        )
    if source == "xero":
        return XeroSource(
            tenant_id=tenant_id,
            mode="live",
            fixtures_dir=cfg.fixtures_dir,
            access_token=access_token(conn, tenant_id, source),
            # Theirs, not ours. See the module docstring in vcdo/sources/xero.py.
            xero_tenant_id=connection.external_account_id,
            expected_tenant_name=connection.external_account_label,
        )
    if source == "gmail":
        return GmailSource(
            tenant_id=tenant_id,
            mode="live",
            fixtures_dir=cfg.fixtures_dir,
            credentials=_google_credentials(conn, tenant_id, source),
            mailbox=connection.external_account_id,
        )
    if source == "drive":
        return DriveSource(
            tenant_id=tenant_id,
            mode="live",
            fixtures_dir=cfg.fixtures_dir,
            credentials=_google_credentials(conn, tenant_id, source),
            folder_ids=tuple(config.get("folder_ids") or ()),
        )
    raise SourceError(f"unknown source {source!r}")


def _google_credentials(conn, tenant_id: str, source: str):
    """A google-auth credential built from the sealed bundle.

    Refresh is handled by the registry rather than by google-auth's own in-place
    refresh, so that the rotated token is written back. google-auth would refresh
    happily and discard the result at the end of the process, making every run
    pay a round trip and hiding a revoked grant until much later.
    """
    from google.oauth2.credentials import Credentials

    from vcdo.core.connections import access_token

    return Credentials(token=access_token(conn, tenant_id, source))


def _sources(cfg: Config, conn=None, tenant_id: str = FIXTURE_TENANT) -> list:
    """Every configured source for one tenant.

    Mode is resolved per source, so one can be live while the rest are mocked ---
    which is how a source is onboarded. Live sources come from the registry and
    therefore need a database connection; mock sources do not.
    """
    if not cfg.live_sources:
        return _mock_sources(cfg, tenant_id)

    if conn is None:
        raise SourceError(
            f"live sources {', '.join(cfg.live_sources)} need the connection registry; "
            "no database connection was supplied"
        )

    mocked = {s.name: s for s in _mock_sources(cfg, tenant_id)}
    return [
        _live_source(cfg, conn, tenant_id, source) if cfg.is_live(source) else mocked[source]
        for source in SOURCES
    ]


def seed(cfg: Config, log: ObsLog, *, conn=None, tenant_id: str = FIXTURE_TENANT) -> dict[str, int]:
    """Land every configured source for one tenant into the raw lake.

    Opens its own database connection only if it needs one -- that is, only when
    a source is live and its credential has to come from the registry. Mock mode
    stays runnable with no stack at all, which is what `make verify` depends on.
    """
    if conn is None and cfg.live_sources:
        with _connect(cfg) as owned:
            result = seed(cfg, log, conn=owned, tenant_id=tenant_id)
            owned.commit()  # a refreshed token was written back
            return result

    lake = _lake(cfg)
    landed = {}
    for source in _sources(cfg, conn, tenant_id):
        for entity in source.entities():
            result = land(source, entity, lake, log)
            landed[f"{source.name}/{entity}"] = result.read

        # Document BYTES are a separate dataset from the metadata records above.
        # A successful message or file-listing sync is not evidence that the PDFs
        # exist as objects -- that is the failure that hides best.
        if isinstance(source, GmailSource):
            docs = land_gmail_attachments(source, lake, log)
            landed["gmail/attachments"] = docs.stored + docs.unchanged
        elif isinstance(source, DriveSource):
            docs = land_drive_pdfs(source, lake, log)
            landed["drive/pdfs"] = docs.stored + docs.unchanged
    return landed


def run_slice(cfg: Config, log: ObsLog, *, tenant_id: str = FIXTURE_TENANT) -> dict[str, int]:
    """The full vertical slice for one tenant: raw -> curated -> a dashboard query.

    ``tenant_id`` is keyword-only and defaulted so that the offline slice, which
    is ADR 0003's stated verification, still runs as ``vcdo slice`` with nothing
    configured. In live mode the caller names the customer.
    """
    from vcdo.curated.link import link_entities
    from vcdo.curated.load import publish_hubspot, publish_xero

    migrate(cfg, log)

    lake = _lake(cfg)
    with _connect(cfg) as conn:
        # Seeding happens inside the connection so live sources can resolve their
        # credentials from the registry, and so a refreshed token is written back
        # in the same transaction that used it.
        landed = seed(cfg, log, conn=conn, tenant_id=tenant_id)

        published = publish_hubspot(lake, conn, log, tenant_id)
        # Xero publishes behind its reconciliation gate; a GateBlocked here
        # propagates and fails the run rather than publishing wrong figures.
        xero = publish_xero(lake, conn, log, tenant_id)
        # Linking runs AFTER both publishes: it is a cross-source operation by
        # definition, and doing it inside one source's publish would link
        # against whatever the other had last time.
        links = link_entities(conn, log, tenant_id)
        conn.commit()

        # The dashboard query, run as part of the slice. A pipeline that loads
        # rows nobody has queried has not been shown to work end to end.
        #
        # Scoped to the tenant. Unscoped, this would sum every customer's deals
        # into one figure and report it as the result of this run -- the same
        # defect migration 006 fixed in customer_commercial_overview, and wrong
        # in the same direction: it looks like more business than there is.
        row = conn.execute(
            """
            SELECT count(*)                                  AS deals,
                   count(*) FILTER (WHERE is_won)            AS won,
                   coalesce(sum(amount) FILTER (WHERE is_won), 0) AS won_amount,
                   count(DISTINCT currency)                  AS currencies
            FROM curated.deals
            WHERE tenant_id = %s
            """,
            (tenant_id,),
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
        "linked": links.linked,
        "needs_review": links.proposed + links.conflicted,
        "won_deals": won,
        "won_amount": won_amount,
        "currencies": currencies,
    }
