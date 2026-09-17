"""The handoff's PDF acceptance gate, against real object storage.

The sharpest single check in the spec: after running both paths, **two actual
PDF objects** must exist in their correct raw prefixes, their SHA-256 must match
the source fixtures byte for byte, manifests must link back to the right source
ids, a repeat run must create no duplicates, a Drive-link-only email must create
no Gmail object, and a corrupt attachment must be reported failed rather than
counted complete.

Byte-exact, not "a PDF was written". A pipeline that stores *a* file is not the
same as one that stores *the* file, and the difference only shows up when someone
needs the document.
"""

import hashlib
import os
import uuid
from pathlib import Path

import pytest

from vcdo.core.config import load
from vcdo.core.obs_log import ObsLog
from vcdo.lake.ingest import land_drive_pdfs, land_gmail_attachments
from vcdo.lake.store import LakeStore
from vcdo.sources.drive import DriveSource, reconcile
from vcdo.sources.gmail import GmailSource

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@pytest.fixture
def lake(tmp_path):
    cfg = load(dict(os.environ))
    try:
        from vcdo.lake.s3 import from_config

        store = from_config(cfg)
        store.put("itest/probe", b"x")
        store.delete("itest/probe")
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"MinIO not reachable: {type(exc).__name__}")

    # One tenant per run isolates BOTH datasets. It previously isolated only
    # Gmail, because the tenant was the mailbox and Drive keys carried no tenant
    # at all -- so `drive/pdf/<file id>` was global and two runs of this file
    # against the same bucket wrote to the same objects.
    tenant = f"itest-{uuid.uuid4().hex[:8]}"
    yield LakeStore(store), ObsLog("itest", log_dir=tmp_path), tenant, store

    for prefix in (f"gmail/{tenant}/", f"drive/{tenant}/"):
        for key in list(store.list(prefix)):
            store.delete(key)


#: The address the fixture mailbox represents. Separate from the tenant now: one
#: names the customer, the other names a person.
MAILBOX = "mailbox@vietcham.example"


def gmail(tenant):
    return GmailSource(tenant_id=tenant, mailbox=MAILBOX, mode="mock", fixtures_dir=str(FIXTURES))


def drive(tenant, listing="files"):
    return DriveSource(tenant_id=tenant, mode="mock", fixtures_dir=str(FIXTURES), listing=listing)


def drive_key(tenant, file_id):
    return f"drive/{tenant}/pdf/{file_id}"


def gmail_key(tenant, message_id, part_id):
    return f"gmail/{tenant}/attachments/{message_id}/{part_id}"


# -- the two PDF objects -----------------------------------------------------


def test_both_paths_land_real_pdf_bytes(lake):
    """Two independently verified objects, from two different ingestion paths."""
    store, log, tenant, _ = lake

    gmail_result = land_gmail_attachments(gmail(tenant), store, log)
    drive_result = land_drive_pdfs(drive(tenant), store, log)

    # stored + unchanged, not stored alone. Drive file ids are fixed, so an
    # earlier run may already hold these objects -- and "present in the lake" is
    # the property that matters, not "written during this particular call".
    assert gmail_result.stored + gmail_result.unchanged == 3
    assert drive_result.stored + drive_result.unchanged == 2


def test_drive_bytes_match_the_source_fixture_exactly(lake):
    store, log, tenant, _ = lake
    land_drive_pdfs(drive(tenant), store, log)

    expected = (FIXTURES / "pdf" / "drive_folder_a_invoice.pdf").read_bytes()
    stored = store.read(drive_key(tenant, "drv-001"))

    assert stored == expected
    assert sha256(stored) == sha256(expected)


def test_gmail_bytes_match_the_source_fixture_exactly(lake):
    store, log, tenant, _ = lake
    land_gmail_attachments(gmail(tenant), store, log)

    expected = (FIXTURES / "pdf" / "gmail_receipt.pdf").read_bytes()
    stored = store.read(gmail_key(tenant, "msg-0001", "1"))

    assert stored == expected
    assert sha256(stored) == sha256(expected)


def test_the_two_paths_write_to_separate_prefixes(lake):
    """drive/<tenant>/pdf/... and gmail/<tenant>/attachments/... are distinct datasets."""
    store, log, tenant, backing = lake
    land_gmail_attachments(gmail(tenant), store, log)
    land_drive_pdfs(drive(tenant), store, log)

    assert any(backing.list(f"drive/{tenant}/pdf/"))
    assert any(backing.list(f"gmail/{tenant}/attachments/"))


# -- provenance --------------------------------------------------------------


def test_every_object_has_a_manifest_linking_to_its_source(lake):
    store, log, tenant, _ = lake
    land_drive_pdfs(drive(tenant), store, log)
    land_gmail_attachments(gmail(tenant), store, log)

    dkey = drive_key(tenant, "drv-001")
    manifest = store.manifest(dkey, store.versions(dkey)[-1])
    assert manifest["drive_file_id"] == "drv-001"
    assert manifest["tenant_id"] == tenant
    assert manifest["name"] == "invoice.pdf"
    assert manifest["sha256"] == sha256((FIXTURES / "pdf" / "drive_folder_a_invoice.pdf").read_bytes())

    mail_key = gmail_key(tenant, "msg-0001", "1")
    manifest = store.manifest(mail_key, store.versions(mail_key)[-1])
    assert manifest["message_id"] == "msg-0001"
    assert manifest["part_id"] == "1"
    # The mailbox and filename left the object key; the manifest is where they
    # are now kept, and this is what proves they were not simply dropped.
    assert manifest["tenant_id"] == tenant
    assert manifest["mailbox"] == MAILBOX
    assert manifest["filename"] == "receipt.pdf"


# -- idempotence -------------------------------------------------------------


def test_a_repeat_run_creates_no_duplicate_objects(lake):
    store, log, tenant, _ = lake
    land_drive_pdfs(drive(tenant), store, log)
    second = land_drive_pdfs(drive(tenant), store, log)

    assert second.stored == 0, "a repeat run must write nothing"
    assert second.unchanged == 2
    assert len(store.versions(drive_key(tenant, "drv-001"))) == 1


def test_a_changed_drive_file_versions_rather_than_overwrites(lake):
    """The old bytes stay. Raw cannot be recomputed, so nothing is replaced."""
    store, log, tenant, _ = lake
    land_drive_pdfs(drive(tenant), store, log)
    land_drive_pdfs(drive(tenant, "files_after_change"), store, log)

    versions = store.versions(drive_key(tenant, "drv-001"))
    assert len(versions) == 2
    assert (
        store.read(drive_key(tenant, "drv-001"), versions[0])
        == (FIXTURES / "pdf" / "drive_folder_a_invoice.pdf").read_bytes()
    )


# -- the negative cases ------------------------------------------------------


def test_a_drive_link_email_creates_no_gmail_object(lake):
    """A link is not an attachment."""
    store, log, tenant, backing = lake
    land_gmail_attachments(gmail(tenant), store, log)

    keys = list(backing.list(f"{gmail_key(tenant, 'msg-0003', '')}"))
    assert keys == []


def test_a_corrupt_attachment_is_reported_failed_not_stored(lake):
    store, log, tenant, backing = lake
    result = land_gmail_attachments(gmail(tenant), store, log)

    assert result.failed == 1
    assert list(backing.list(f"{gmail_key(tenant, 'msg-0005', '')}")) == []


def test_a_zip_named_pdf_is_skipped_and_counted_separately_from_failure(lake):
    """Skipped and failed are different states; conflating them hides real problems."""
    store, log, tenant, _ = lake
    result = land_gmail_attachments(gmail(tenant), store, log)

    assert result.skipped == 1
    assert result.failed == 1


def test_a_non_pdf_in_drive_is_excluded(lake):
    store, log, tenant, backing = lake
    land_drive_pdfs(drive(tenant), store, log)

    assert list(backing.list(drive_key(tenant, "drv-003"))) == []


# -- deletion reconciliation -------------------------------------------------


def test_a_deleted_drive_file_is_detected_by_full_comparison(lake):
    """Drive gives no consumable deletion stream, so this is the only honest way."""
    store, log, tenant, _ = lake
    land_drive_pdfs(drive(tenant), store, log)

    held = {"drv-001", "drv-002"}
    upstream = {f.file_id for f in drive(tenant, "files_after_change").pdf_files()}

    result = reconcile(upstream_ids=upstream, held_ids=held)

    assert result.tombstoned == ["drv-002"]
    # The bytes are NOT deleted: raw is evidence of what was once there.
    assert store.read(drive_key(tenant, "drv-002")).startswith(b"%PDF-")
