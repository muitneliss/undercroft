"""The raw lake must never lose or quietly alter what it captured.

Raw is the only layer that cannot be recomputed. These tests pin the three
promises that make it an archive rather than a cache, plus the key-shape guard
that stops retention deleting sibling data.
"""

from datetime import UTC, datetime, timedelta

import pytest

from vcdo.lake.memory import InMemoryObjectStore
from vcdo.lake.store import LakeStore, ObjectExists, sha256_hex

PDF = b"%PDF-1.7\nfixture invoice\n%%EOF"


def at(day: int, hour: int = 0) -> datetime:
    return datetime(2026, 9, day, hour, 0, 0, tzinfo=UTC)


def test_stored_bytes_come_back_byte_for_byte():
    lake = LakeStore(InMemoryObjectStore())
    lake.put("drive/pdf/file-1", PDF, run_id="r1", now=at(1))

    assert lake.read("drive/pdf/file-1") == PDF


def test_restoring_identical_bytes_writes_nothing():
    """Without this, an hourly schedule evicts real history using only copies.

    Retention keeps N versions. If every poll of an unchanged file created a
    version, N polls would push out every genuine prior observation, and the
    store would report a full archive while holding one document N times.
    """
    backing = InMemoryObjectStore()
    lake = LakeStore(backing)

    first = lake.put("drive/pdf/file-1", PDF, run_id="r1", now=at(1))
    size_after_first = len(backing)
    second = lake.put("drive/pdf/file-1", PDF, run_id="r2", now=at(2))

    assert first.status == "created"
    assert second.status == "unchanged"
    assert len(backing) == size_after_first
    assert lake.versions("drive/pdf/file-1") == ["20260901T000000Z"]


def test_an_existing_observation_is_never_replaced():
    """Create-only. A store that can be overwritten is a cache, not an archive."""
    lake = LakeStore(InMemoryObjectStore())
    lake.put("drive/pdf/file-1", PDF, run_id="r1", now=at(1))

    with pytest.raises(ObjectExists):
        lake.put("drive/pdf/file-1", b"%PDF-1.7\ndifferent\n%%EOF", run_id="r2", now=at(1))


def test_changed_bytes_create_a_new_version_and_keep_the_old_one():
    lake = LakeStore(InMemoryObjectStore())
    lake.put("drive/pdf/file-1", PDF, run_id="r1", now=at(1))
    changed = b"%PDF-1.7\nrevised invoice\n%%EOF"
    lake.put("drive/pdf/file-1", changed, run_id="r2", now=at(2))

    stamps = lake.versions("drive/pdf/file-1")
    assert len(stamps) == 2
    assert lake.read("drive/pdf/file-1", stamps[0]) == PDF
    assert lake.read("drive/pdf/file-1", stamps[1]) == changed


def test_pruning_reports_exactly_what_it_removed_oldest_first():
    """Silent pruning of a durable store is indistinguishable from data loss."""
    lake = LakeStore(InMemoryObjectStore(), retention=3)
    for day in range(1, 5):
        lake.put("xero/invoices/INV-1", f"payload {day}".encode(), run_id=f"r{day}", now=at(day))

    assert lake.versions("xero/invoices/INV-1") == [
        "20260902T000000Z",
        "20260903T000000Z",
        "20260904T000000Z",
    ]


def test_nothing_is_discarded_by_default():
    """Owner decision 2026-09-17: keep everything until a retention policy exists.

    A default that quietly drops history would make that decision silently
    untrue, and the loss would only surface when someone needed the old version.
    """
    lake = LakeStore(InMemoryObjectStore())
    base = at(1)
    for n in range(40):
        lake.put(
            "xero/invoices/INV-1",
            f"payload {n}".encode(),
            run_id=f"r{n}",
            now=base + timedelta(hours=n),
        )

    assert len(lake.versions("xero/invoices/INV-1")) == 40


def test_prune_returns_the_removed_names():
    lake = LakeStore(InMemoryObjectStore(), retention=2)
    lake.put("xero/invoices/INV-1", b"a", run_id="r1", now=at(1))
    lake.put("xero/invoices/INV-1", b"b", run_id="r2", now=at(2))
    result = lake.put("xero/invoices/INV-1", b"c", run_id="r3", now=at(3))

    assert result.pruned == ["20260901T000000Z"]


def test_identical_payloads_at_different_keys_are_stored_once():
    """The same PDF in fifty mailboxes is one blob and fifty observations.

    The legacy store addressed by provenance and held 10.42 GB where 1.98 GB
    would do, with one document duplicated across 126 keys.
    """
    backing = InMemoryObjectStore()
    lake = LakeStore(backing)

    lake.put("gmail/attachments/mbox-a/msg-1/0", PDF, run_id="r1", now=at(1))
    lake.put("gmail/attachments/mbox-b/msg-9/0", PDF, run_id="r1", now=at(1))

    blob_keys = [k for k in backing.list("_blobs/")]
    assert len(blob_keys) == 1
    assert backing.total_bytes < len(PDF) * 2 + 2000  # one payload, two manifests


def test_same_filename_in_different_folders_stays_distinguishable():
    """Handoff acceptance case: two PDFs named invoice.pdf in different subfolders."""
    lake = LakeStore(InMemoryObjectStore())
    a = b"%PDF-1.7\nfolder A invoice\n%%EOF"
    b = b"%PDF-1.7\nfolder B invoice\n%%EOF"

    lake.put("drive/pdf/id-aaa/invoice.pdf", a, run_id="r1", now=at(1))
    lake.put("drive/pdf/id-bbb/invoice.pdf", b, run_id="r1", now=at(1))

    assert lake.read("drive/pdf/id-aaa/invoice.pdf") == a
    assert lake.read("drive/pdf/id-bbb/invoice.pdf") == b


def test_manifest_records_provenance_for_every_observation():
    lake = LakeStore(InMemoryObjectStore())
    lake.put(
        "drive/pdf/id-aaa/invoice.pdf",
        PDF,
        run_id="run-42",
        reason="drive raw copy",
        extra={"drive_file_id": "id-aaa", "md5_checksum": "abc"},
        now=at(1),
    )

    man = lake.manifest("drive/pdf/id-aaa/invoice.pdf", "20260901T000000Z")
    assert man["sha256"] == sha256_hex(PDF)
    assert man["bytes"] == len(PDF)
    assert man["run_id"] == "run-42"
    assert man["drive_file_id"] == "id-aaa"


def test_manifest_omits_row_count_unless_the_caller_defines_one():
    """A number with no definition is worse than an absent one."""
    lake = LakeStore(InMemoryObjectStore())
    lake.put("drive/pdf/id-aaa/invoice.pdf", PDF, run_id="r1", now=at(1))

    assert "row_count" not in lake.manifest("drive/pdf/id-aaa/invoice.pdf", "20260901T000000Z")


def test_corrupt_blob_raises_rather_than_returning_suspect_bytes():
    backing = InMemoryObjectStore()
    lake = LakeStore(backing)
    lake.put("drive/pdf/file-1", PDF, run_id="r1", now=at(1))

    backing.put(lake.blob_key(sha256_hex(PDF)), b"tampered")

    with pytest.raises(ObjectExists):
        lake.read("drive/pdf/file-1")


def test_a_container_key_is_refused_so_retention_cannot_eat_siblings():
    """The legacy prune walked entity directories when handed an intermediate key.

    The docstring promised a leaf shape that no code enforced. It was right for
    every caller that existed, so nobody checked.
    """
    lake = LakeStore(InMemoryObjectStore())

    with pytest.raises(ValueError, match="too shallow"):
        lake.put("xero", b"x", run_id="r1", now=at(1))


def test_reserved_and_traversing_keys_are_refused():
    lake = LakeStore(InMemoryObjectStore())

    with pytest.raises(ValueError):
        lake.put("_blobs/aa/deadbeef", b"x", run_id="r1", now=at(1))
    with pytest.raises(ValueError):
        lake.put("xero/../../etc/passwd", b"x", run_id="r1", now=at(1))


def test_non_timestamp_entries_are_never_prune_candidates():
    """Anything we did not write is not ours to delete."""
    backing = InMemoryObjectStore()
    lake = LakeStore(backing, retention=1)
    backing.put("xero/invoices/INV-1/notes.txt", b"human note")
    lake.put("xero/invoices/INV-1", b"a", run_id="r1", now=at(1))
    lake.put("xero/invoices/INV-1", b"b", run_id="r2", now=at(2))

    assert backing.exists("xero/invoices/INV-1/notes.txt")
