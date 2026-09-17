"""The S3 store must satisfy the same contract as the in-memory one.

The unit suite proves LakeStore's invariants against InMemoryObjectStore. That is
only meaningful if the real backend behaves identically --- otherwise the suite is
green and production is the untested path.

Skips cleanly when the stack is not running, so `make verify` stays green offline.
A skip is honest; a mock pretending to be MinIO is not.
"""

import os
import uuid

import pytest

from vcdo.core.config import load
from vcdo.lake.store import LakeStore, ObjectExists, sha256_hex

pytestmark = pytest.mark.integration

PDF = b"%PDF-1.7\nintegration fixture\n%%EOF"


@pytest.fixture
def lake():
    """A LakeStore backed by real MinIO, namespaced per test run."""
    cfg = load(dict(os.environ))
    from vcdo.lake.s3 import from_config

    store = from_config(cfg)
    try:
        store.put("itest/probe", b"x")
        store.delete("itest/probe")
    except Exception as exc:  # noqa: BLE001 - any failure to reach MinIO means skip
        pytest.skip(f"MinIO not reachable at {cfg.s3_endpoint}: {type(exc).__name__}")

    # Not `_test/...`: keys beginning with `_` are reserved for the blob and
    # manifest namespaces, and the store rightly refuses them.
    prefix = f"itest/{uuid.uuid4().hex[:12]}"
    yield LakeStore(store), prefix

    for key in list(store.list(prefix)):
        store.delete(key)


def test_bytes_survive_a_real_round_trip(lake):
    store, prefix = lake
    store.put(f"{prefix}/drive/invoice.pdf", PDF, run_id="itest")

    assert store.read(f"{prefix}/drive/invoice.pdf") == PDF


def test_content_idempotence_holds_against_real_storage(lake):
    store, prefix = lake
    key = f"{prefix}/drive/invoice.pdf"

    first = store.put(key, PDF, run_id="itest-1")
    second = store.put(key, PDF, run_id="itest-2")

    assert first.status == "created"
    assert second.status == "unchanged"
    assert len(store.versions(key)) == 1


def test_create_only_holds_against_real_storage(lake):
    """S3 PUT overwrites by default. The guard above it must prevent that."""
    from datetime import UTC, datetime

    store, prefix = lake
    key = f"{prefix}/drive/invoice.pdf"
    fixed = datetime(2026, 9, 1, tzinfo=UTC)
    store.put(key, PDF, run_id="itest-1", now=fixed)

    with pytest.raises(ObjectExists):
        store.put(key, b"%PDF-1.7\ndifferent\n%%EOF", run_id="itest-2", now=fixed)


def test_deduplication_holds_against_real_storage(lake):
    store, prefix = lake
    store.put(f"{prefix}/gmail/mbox-a/msg-1/0", PDF, run_id="itest")
    store.put(f"{prefix}/gmail/mbox-b/msg-9/0", PDF, run_id="itest")

    assert store.read(f"{prefix}/gmail/mbox-a/msg-1/0") == PDF
    assert store.read(f"{prefix}/gmail/mbox-b/msg-9/0") == PDF
    assert store.blob_key(sha256_hex(PDF)).startswith("_blobs/")


def test_listing_pages_past_the_thousand_key_limit(lake):
    """`list_objects_v2` truncates at 1000 keys and still returns success.

    A single unpaginated call reports a partial lake, which downstream reads as
    "those objects do not exist" -- silent, and worst at scale.
    """
    store, prefix = lake
    backing = store._store
    for i in range(1050):
        backing.put(f"{prefix}/bulk/{i:05d}", b"x")

    assert len(list(backing.list(f"{prefix}/bulk/"))) == 1050
