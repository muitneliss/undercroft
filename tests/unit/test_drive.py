"""Drive PDF copy and deletion reconciliation.

The deletion case is the one no connector handles: Drive reports additions and
edits, never a consumable stream of deletions, so a removed file just stops
appearing and an incremental pipeline serves it forever.
"""

import hashlib
from pathlib import Path

from vcdo.sources.drive import DriveSource, reconcile, verify_against_drive_md5

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures"


def source(listing: str = "files") -> DriveSource:
    return DriveSource(tenant_id="drive-root", mode="mock", fixtures_dir=str(FIXTURES), listing=listing)


def test_pdfs_are_copied_with_their_original_bytes():
    files = list(source().pdf_files())

    assert {f.file_id for f in files} == {"drv-001", "drv-002"}
    for f in files:
        assert f.data.startswith(b"%PDF-")


def test_two_files_named_invoice_pdf_stay_distinguishable():
    """Handoff acceptance case. Keying on name would silently overwrite one."""
    files = {f.file_id: f for f in source().pdf_files()}

    a, b = files["drv-001"], files["drv-002"]
    assert a.name == b.name == "invoice.pdf"
    assert a.lake_key() != b.lake_key()
    assert a.data != b.data


def test_a_non_pdf_in_the_same_folder_is_excluded():
    assert "drv-003" not in {f.file_id for f in source().pdf_files()}


def test_google_native_documents_are_skipped_not_exported():
    """Exporting a Google Doc produces a DIFFERENT artifact, not a copy.

    Storing it as though it were the original would put a generated file in the
    raw lake labelled as the source document.
    """
    assert "drv-004" not in {f.file_id for f in source().pdf_files()}


def test_drive_md5_is_used_as_an_independent_check():
    """Our own SHA-256 would happily hash truncated bytes; a hash of the wrong
    bytes is still a valid hash."""
    f = next(f for f in source().pdf_files() if f.file_id == "drv-001")

    assert verify_against_drive_md5(f.data, f.md5_checksum) is True
    assert verify_against_drive_md5(b"different bytes", f.md5_checksum) is False


def test_a_file_with_no_checksum_offered_is_not_treated_as_a_mismatch():
    assert verify_against_drive_md5(b"anything", None) is True


def test_the_checksum_matches_what_drive_reported():
    f = next(f for f in source().pdf_files() if f.file_id == "drv-002")

    assert hashlib.md5(f.data).hexdigest() == f.md5_checksum


# -- reconciliation ----------------------------------------------------------


def test_a_file_removed_upstream_is_tombstoned():
    """The case Drive gives you no stream for."""
    before = {f.file_id for f in source().pdf_files()}
    after = {f.file_id for f in source("files_after_change").pdf_files()}

    result = reconcile(upstream_ids=after, held_ids=before)

    assert "drv-002" in result.tombstoned
    assert "drv-002" not in result.present


def test_a_new_file_is_reported_as_added():
    before = {f.file_id for f in source().pdf_files()}
    after = {f.file_id for f in source("files_after_change").pdf_files()}

    result = reconcile(upstream_ids=after, held_ids=before)

    assert "drv-005" in result.added


def test_a_changed_file_is_reported_separately_from_an_added_one():
    """A new version of an existing document is not a new document."""
    result = reconcile(
        upstream_ids={"drv-001", "drv-005"},
        held_ids={"drv-001", "drv-002"},
        changed_ids={"drv-001"},
    )

    assert result.changed == ["drv-001"]
    assert result.added == ["drv-005"]
    assert result.tombstoned == ["drv-002"]


def test_a_changed_pdf_produces_different_bytes():
    a = next(f for f in source().pdf_files() if f.file_id == "drv-001")
    b = next(f for f in source("files_after_change").pdf_files() if f.file_id == "drv-001")

    assert a.data != b.data
    assert a.lake_key() == b.lake_key(), "same document, so same key -- the lake versions it"


def test_nothing_is_tombstoned_when_the_listing_is_unchanged():
    """A guard that fires on a steady state would tombstone the whole corpus."""
    ids = {f.file_id for f in source().pdf_files()}

    result = reconcile(upstream_ids=ids, held_ids=ids)

    assert result.tombstoned == []
    assert result.added == []
