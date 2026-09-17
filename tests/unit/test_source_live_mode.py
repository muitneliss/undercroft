"""What each source refuses to start without, and what it must not confuse.

No gate test previously constructed a source in live mode, so the whole live path
was unguarded: `VCDO_XERO_MODE=live` passed config validation and then crashed in
the constructor, and `make verify` was green over it.

The specific defect these pin is the two-tenants problem. `tenant_id` is ours --
the CASE-ID naming the customer whose lake this is. Xero's organisation id and
the Gmail mailbox are *theirs*. While they shared one field, live Xero would have
sent `portal-fixture` in the `xero-tenant-id` header, which is to say live Xero
had never run.

Each guard gets both tests: one proving it fires, one proving it stays quiet.
"""

import pytest

from vcdo.sources.base import SourceError
from vcdo.sources.drive import DriveSource
from vcdo.sources.gmail import GmailSource
from vcdo.sources.hubspot import HubSpotSource
from vcdo.sources.xero import XeroSource

TENANT = "CASE-001"


# -- mock mode needs no credential -------------------------------------------


def test_every_source_constructs_in_mock_mode_without_a_credential():
    """The offline path must work before any credential exists; ADR 0002."""
    for source in (
        HubSpotSource(tenant_id=TENANT),
        XeroSource(tenant_id=TENANT),
        GmailSource(tenant_id=TENANT),
        DriveSource(tenant_id=TENANT),
    ):
        assert source.tenant_id == TENANT


# -- xero: our tenant is not their organisation ------------------------------


def test_xero_live_refuses_without_the_organisation_id():
    """Ours in the `xero-tenant-id` header is a 401 at best, the wrong org at worst."""
    with pytest.raises(SourceError, match="xero_tenant_id"):
        XeroSource(tenant_id=TENANT, mode="live", access_token="tok")


def test_xero_live_accepts_our_tenant_and_their_organisation_together():
    source = XeroSource(
        tenant_id=TENANT,
        mode="live",
        access_token="tok",
        xero_tenant_id="xero-org-uuid",
    )

    assert source.tenant_id == TENANT
    assert source.xero_tenant_id == "xero-org-uuid"


def test_xero_live_refuses_without_an_access_token():
    with pytest.raises(SourceError, match="access token"):
        XeroSource(tenant_id=TENANT, mode="live", xero_tenant_id="xero-org-uuid")


# -- the other three ---------------------------------------------------------


def test_hubspot_live_refuses_without_a_token():
    with pytest.raises(SourceError, match="token"):
        HubSpotSource(tenant_id=TENANT, mode="live")


def test_hubspot_live_starts_with_a_token():
    assert HubSpotSource(tenant_id=TENANT, mode="live", token="tok").mode == "live"


def test_gmail_live_refuses_without_credentials():
    with pytest.raises(SourceError, match="OAuth"):
        GmailSource(tenant_id=TENANT, mode="live")


def test_gmail_live_refuses_without_the_mailbox_it_believes_it_reads():
    """Live reads use userId="me", so an unnamed mailbox mis-connects silently."""
    with pytest.raises(SourceError, match="mailbox"):
        GmailSource(tenant_id=TENANT, mode="live", credentials=object())


def test_gmail_live_starts_with_credentials_and_a_mailbox():
    source = GmailSource(
        tenant_id=TENANT,
        mode="live",
        credentials=object(),
        mailbox="finance@example.test",
    )

    assert source.tenant_id == TENANT
    assert source.mailbox == "finance@example.test"


def test_drive_live_refuses_without_credentials():
    with pytest.raises(SourceError, match="OAuth"):
        DriveSource(tenant_id=TENANT, mode="live")


# -- drive: an unscoped listing copies the customer's whole Drive ------------

FOLDER = "1AbCdEfGhIjKlMnOpQrStUv"


def test_drive_live_refuses_an_unscoped_listing():
    """The lake is create-only, so bytes copied by mistake cannot be un-copied."""
    with pytest.raises(SourceError, match="folder_ids"):
        DriveSource(tenant_id=TENANT, mode="live", credentials=object())


def test_drive_live_starts_when_the_folders_are_named():
    source = DriveSource(
        tenant_id=TENANT,
        mode="live",
        credentials=object(),
        folder_ids=(FOLDER,),
    )

    assert source.folder_ids == (FOLDER,)


def test_drive_refuses_a_folder_id_that_is_not_one():
    """Folder ids reach Drive's `q` query from operator config, so shape is checked."""
    with pytest.raises(SourceError, match="not a Drive file id"):
        DriveSource(
            tenant_id=TENANT,
            mode="live",
            credentials=object(),
            folder_ids=("' or trashed = false or '",),
        )


def test_drive_mock_mode_needs_no_folders():
    """Scoping is a live-mode concern; the fixture listing is already bounded."""
    assert DriveSource(tenant_id=TENANT).folder_ids == ()
