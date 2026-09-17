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

    mailbox = f"itest-{uuid.uuid4().hex[:8]}@vietcham.example"
    yield LakeStore(store), ObsLog("itest", log_dir=tmp_path), mailbox, store

    for prefix in (f"gmail/attachments/{mailbox}/", "drive/pdf/"):
        for key in list(store.list(prefix)):
            store.delete(key)


def gmail(mailbox):
    return GmailSource(tenant_id=mailbox, mode="mock", fixtures_dir=str(FIXTURES))


def drive(listing="files"):
    return DriveSource(tenant_id="drive-root", mode="mock", fixtures_dir=str(FIXTURES), listing=listing)


# -- the two PDF objects -----------------------------------------------------


def test_both_paths_land_real_pdf_bytes(lake):
    """Two independently verified objects, from two different ingestion paths."""
    store, log, mailbox, _ = lake

    gmail_result = land_gmail_attachments(gmail(mailbox), store, log)
    drive_result = land_drive_pdfs(drive(), store, log)

    assert gmail_result.stored == 3  # receipt, statement, and the second receipt.pdf
    assert drive_result.stored == 2  # the two invoice.pdf in different folders


def test_drive_bytes_match_the_source_fixture_exactly(lake):
    store, log, _, _ = lake
    land_drive_pdfs(drive(), store, log)

    expected = (FIXTURES / "pdf" / "drive_folder_a_invoice.pdf").read_bytes()
    stored = store.read("drive/pdf/drv-001/invoice.pdf")

    assert stored == expected
    assert sha256(stored) == sha256(expected)


def test_gmail_bytes_match_the_source_fixture_exactly(lake):
    store, log, mailbox, _ = lake
    land_gmail_attachments(gmail(mailbox), store, log)

    expected = (FIXTURES / "pdf" / "gmail_receipt.pdf").read_bytes()
    stored = store.read(f"gmail/attachments/{mailbox}/msg-0001/1/receipt.pdf")

    assert stored == expected
    assert sha256(stored) == sha256(expected)


def test_the_two_paths_write_to_separate_prefixes(lake):
    """raw/drive/pdf/... and raw/gmail/attachments/... are distinct datasets."""
    store, log, mailbox, backing = lake
    land_gmail_attachments(gmail(mailbox), store, log)
    land_drive_pdfs(drive(), store, log)

    assert any(k.startswith("drive/pdf/") for k in backing.list("drive/pdf/"))
    assert any(k.startswith(f"gmail/attachments/{mailbox}/") for k in backing.list("gmail/attachments/"))


# -- provenance --------------------------------------------------------------


def test_every_object_has_a_manifest_linking_to_its_source(lake):
    store, log, mailbox, _ = lake
    land_drive_pdfs(drive(), store, log)
    land_gmail_attachments(gmail(mailbox), store, log)

    drive_key = "drive/pdf/drv-001/invoice.pdf"
    manifest = store.manifest(drive_key, store.versions(drive_key)[-1])
    assert manifest["drive_file_id"] == "drv-001"
    assert manifest["sha256"] == sha256((FIXTURES / "pdf" / "drive_folder_a_invoice.pdf").read_bytes())

    mail_key = f"gmail/attachments/{mailbox}/msg-0001/1/receipt.pdf"
    manifest = store.manifest(mail_key, store.versions(mail_key)[-1])
    assert manifest["message_id"] == "msg-0001"
    assert manifest["mailbox"] == mailbox
    assert manifest["part_id"] == "1"


# -- idempotence -------------------------------------------------------------


def test_a_repeat_run_creates_no_duplicate_objects(lake):
    store, log, mailbox, _ = lake
    land_drive_pdfs(drive(), store, log)
    second = land_drive_pdfs(drive(), store, log)

    assert second.stored == 0
    assert second.unchanged == 2
    assert len(store.versions("drive/pdf/drv-001/invoice.pdf")) == 1


def test_a_changed_drive_file_versions_rather_than_overwrites(lake):
    """The old bytes stay. Raw cannot be recomputed, so nothing is replaced."""
    store, log, _, _ = lake
    land_drive_pdfs(drive(), store, log)
    land_drive_pdfs(drive("files_after_change"), store, log)

    versions = store.versions("drive/pdf/drv-001/invoice.pdf")
    assert len(versions) == 2
    assert (
        store.read("drive/pdf/drv-001/invoice.pdf", versions[0])
        == (FIXTURES / "pdf" / "drive_folder_a_invoice.pdf").read_bytes()
    )


# -- the negative cases ------------------------------------------------------


def test_a_drive_link_email_creates_no_gmail_object(lake):
    """A link is not an attachment."""
    store, log, mailbox, backing = lake
    land_gmail_attachments(gmail(mailbox), store, log)

    keys = list(backing.list(f"gmail/attachments/{mailbox}/msg-0003/"))
    assert keys == []


def test_a_corrupt_attachment_is_reported_failed_not_stored(lake):
    store, log, mailbox, backing = lake
    result = land_gmail_attachments(gmail(mailbox), store, log)

    assert result.failed == 1
    assert list(backing.list(f"gmail/attachments/{mailbox}/msg-0005/")) == []


def test_a_zip_named_pdf_is_skipped_and_counted_separately_from_failure(lake):
    """Skipped and failed are different states; conflating them hides real problems."""
    store, log, mailbox, _ = lake
    result = land_gmail_attachments(gmail(mailbox), store, log)

    assert result.skipped == 1
    assert result.failed == 1


def test_a_non_pdf_in_drive_is_excluded(lake):
    store, log, _, backing = lake
    land_drive_pdfs(drive(), store, log)

    assert list(backing.list("drive/pdf/drv-003/")) == []


# -- deletion reconciliation -------------------------------------------------


def test_a_deleted_drive_file_is_detected_by_full_comparison(lake):
    """Drive gives no consumable deletion stream, so this is the only honest way."""
    store, log, _, _ = lake
    land_drive_pdfs(drive(), store, log)

    held = {"drv-001", "drv-002"}
    upstream = {f.file_id for f in drive("files_after_change").pdf_files()}

    result = reconcile(upstream_ids=upstream, held_ids=held)

    assert result.tombstoned == ["drv-002"]
    # The bytes are NOT deleted: raw is evidence of what was once there.
    assert store.read("drive/pdf/drv-002/invoice.pdf").startswith(b"%PDF-")
