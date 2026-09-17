"""Content-addressed immutable object store for the raw lake.

The raw lake is the only layer that **cannot be recomputed**. If a third party
edits or deletes their side, whatever we did not capture is gone permanently.
Everything downstream --- curated tables, marts, dashboards --- is a projection
that may be dropped and rebuilt freely. That asymmetry is the whole design.

Three invariants, each pinned by a test:

1. **Create-only.** Writing where an object already exists is an error, never a
   silent replace. A store that can be overwritten is a cache, not an archive.

2. **Idempotent by content.** Re-storing identical bytes writes nothing and
   reports ``unchanged``. Without this, an hourly schedule pushes real history
   out through retention using nothing but copies of the same file.

3. **Retention is bounded and reported.** Pruning names what it removed. Silent
   pruning of a durable store is indistinguishable from data loss.

Content addressing is the default here, not a later optimisation. The legacy
store addressed by provenance and measured 15,790 artefacts holding 5,259
distinct payloads --- 10.42 GB where 1.98 GB would do, with one 6.8 MB document
stored under 126 separate keys. Retrofitting deduplication onto that cost a
dedicated migration. Starting content-addressed skips the entire problem.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

__all__ = ["ObjectStore", "LakeStore", "PutResult", "ObjectExists", "sha256_hex"]

#: Default retention: ``None`` means keep every observation, forever.
#:
#: This is a deliberate decision (owner, 2026-09-17), not an oversight. The lake
#: is the only layer that cannot be recomputed, and a retention policy has not
#: been set yet, so the safe default is to discard nothing. Note that create-only
#: plus content-idempotence already bounds growth by *real* change: re-observing
#: an unchanged file costs one manifest, not one copy.
#:
#: This will need revisiting. Under Singapore PDPA, personal data must not be
#: retained once it no longer serves a business or legal purpose, so "keep
#: everything" is a starting position with a deadline, not a permanent policy.
#: Tracked in docs/adr/0002.
RETENTION_UNBOUNDED = None

_STAMP = "%Y%m%dT%H%M%SZ"


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class ObjectExists(Exception):
    """Raised when a write would replace an existing object."""


class ObjectStore(Protocol):
    """The storage seam.

    Narrow on purpose. S3, MinIO and the in-memory test double all satisfy it,
    so every test above this line runs with no network and no credentials.
    """

    def get(self, key: str) -> bytes: ...
    def put(self, key: str, data: bytes) -> None: ...
    def exists(self, key: str) -> bool: ...
    def list(self, prefix: str) -> Iterator[str]: ...
    def delete(self, key: str) -> None: ...


@dataclass(frozen=True, slots=True)
class PutResult:
    """What a store operation actually did.

    ``status`` is one of ``created`` or ``unchanged``. Callers use it to
    distinguish "we observed new data" from "we observed the same data again",
    which is the difference between a source that is alive and one that is
    silently stalled.
    """

    status: str
    sha256: str
    blob_key: str
    version_key: str
    bytes: int
    pruned: list[str] = field(default_factory=list)


class LakeStore:
    """Immutable, content-addressed, provenance-indexed raw storage.

    Two layers of key:

    - ``_blobs/<sha[:2]>/<sha256>`` holds exactly one copy of each distinct
      payload.
    - ``<source_key>/<timestamp>/manifest.json`` records *that we observed this
      payload here, then*. Many observations may point at one blob.

    Separating them is what lets the same PDF appear in fifty mailboxes without
    being stored fifty times, while still answering "where did this come from
    and when did we see it".
    """

    def __init__(self, store: ObjectStore, *, retention: int | None = RETENTION_UNBOUNDED) -> None:
        if retention is not None and retention < 1:
            raise ValueError("retention must be at least 1, or None to keep everything")
        self._store = store
        self._retention = retention

    # -- keys ---------------------------------------------------------------

    @staticmethod
    def blob_key(digest: str) -> str:
        return f"_blobs/{digest[:2]}/{digest}"

    @staticmethod
    def _validate_source_key(source_key: str) -> str:
        """Reject key shapes that make pruning dangerous.

        In the legacy store, ``snapshot_dirs()`` listed every subdirectory of a
        key and treated each as a version. A key naming an *intermediate* node
        therefore made prune walk entity directories and delete customer data.
        The docstring promised a shape that no line of code enforced --- a
        sleeping trap that is correct for every current caller and detonates on
        the first one who does not know the promise.

        So the shape is enforced here, at the only place keys enter the store.
        """
        key = source_key.strip("/")
        if not key:
            raise ValueError("source_key must not be empty")
        if ".." in key.split("/"):
            raise ValueError(f"source_key must not traverse: {source_key!r}")
        if key.startswith("_"):
            raise ValueError(f"source_key must not shadow a reserved prefix: {source_key!r}")
        if len(key.split("/")) < 2:
            raise ValueError(
                f"source_key {source_key!r} is too shallow: it must name a leaf "
                "(e.g. 'xero/invoices/INV-001'), not a container. A container key "
                "would make retention prune sibling entities."
            )
        return key

    # -- writing ------------------------------------------------------------

    def put(
        self,
        source_key: str,
        data: bytes,
        *,
        run_id: str,
        reason: str = "",
        extra: dict | None = None,
        now: datetime | None = None,
    ) -> PutResult:
        """Store ``data`` observed at ``source_key``.

        Returns ``unchanged`` without writing if the newest observation at this
        key already has these bytes.
        """
        key = self._validate_source_key(source_key)
        digest = sha256_hex(data)
        blob = self.blob_key(digest)

        if self.newest_sha(key) == digest:
            return PutResult("unchanged", digest, blob, "", len(data))

        # The blob is shared, so an existing one with a matching digest is not a
        # collision --- it is the deduplication working. Only write if absent.
        if not self._store.exists(blob):
            self._store.put(blob, data)

        stamp = (now or datetime.now(UTC)).strftime(_STAMP)
        version_key = f"{key}/{stamp}"
        manifest_key = f"{version_key}/manifest.json"
        if self._store.exists(manifest_key):
            raise ObjectExists(
                f"refusing to overwrite an existing observation at {manifest_key}. "
                "The raw lake is create-only."
            )

        manifest = {
            "source_key": key,
            "sha256": digest,
            "blob_key": blob,
            "bytes": len(data),
            "run_id": run_id,
            "observed_at": (now or datetime.now(UTC)).isoformat(),
            "reason": reason,
            # `row_count` is deliberately absent unless a caller supplies one it
            # can define. A number with no definition is worse than no number.
            **(extra or {}),
        }
        self._store.put(manifest_key, json.dumps(manifest, indent=2, sort_keys=True).encode())

        pruned = self.prune(key)
        return PutResult("created", digest, blob, version_key, len(data), pruned)

    # -- reading ------------------------------------------------------------

    def versions(self, source_key: str) -> list[str]:
        """Observation timestamps at this key, oldest first.

        Only entries that look like a timestamp are returned. Anything else is
        not ours and is never a prune candidate.
        """
        key = self._validate_source_key(source_key)
        stamps = set()
        for obj in self._store.list(f"{key}/"):
            rest = obj[len(key) + 1 :]
            head = rest.split("/", 1)[0]
            if _is_stamp(head):
                stamps.add(head)
        return sorted(stamps)

    def manifest(self, source_key: str, stamp: str) -> dict:
        key = self._validate_source_key(source_key)
        return json.loads(self._store.get(f"{key}/{stamp}/manifest.json"))

    def newest_sha(self, source_key: str) -> str | None:
        stamps = self.versions(source_key)
        if not stamps:
            return None
        return self.manifest(source_key, stamps[-1]).get("sha256")

    def read(self, source_key: str, stamp: str | None = None) -> bytes:
        """Return the payload bytes for an observation, verifying the digest.

        A mismatch raises rather than returning suspect bytes. Silent corruption
        that flows downstream is far more expensive than a loud failure.
        """
        key = self._validate_source_key(source_key)
        stamps = self.versions(key)
        if not stamps:
            raise KeyError(f"no observations at {key}")
        chosen = stamp or stamps[-1]
        man = self.manifest(key, chosen)
        data = self._store.get(man["blob_key"])
        actual = sha256_hex(data)
        if actual != man["sha256"]:
            raise ObjectExists(
                f"blob for {key}/{chosen} is corrupt: manifest says {man['sha256']}, bytes hash to {actual}"
            )
        return data

    # -- retention ----------------------------------------------------------

    def prune(self, source_key: str) -> list[str]:
        """Trim to ``retention`` observations, oldest first. Returns what it removed.

        Blobs are never pruned here. A blob may be referenced by observations at
        other keys, and working out whether it is safe to delete is a separate,
        deliberate garbage-collection step --- not something retention should do
        as a side effect.
        """
        if self._retention is None:
            return []
        key = self._validate_source_key(source_key)
        stamps = self.versions(key)
        excess = len(stamps) - self._retention
        if excess <= 0:
            return []
        removed = []
        for stamp in stamps[:excess]:
            for obj in list(self._store.list(f"{key}/{stamp}/")):
                self._store.delete(obj)
            removed.append(stamp)
        return removed


def _is_stamp(value: str) -> bool:
    try:
        datetime.strptime(value, _STAMP)
    except ValueError:
        return False
    return True
