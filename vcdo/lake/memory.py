"""In-memory :class:`~vcdo.lake.store.ObjectStore`, for tests and local runs.

A real implementation of the contract, not a mock. It stores bytes, enforces
missing-key errors, and behaves like the S3 client above it. That means the
tests exercising the lake are testing the actual store logic rather than
asserting that a mock was called --- the failure mode where a suite is green and
the code has never run.
"""

from __future__ import annotations

from collections.abc import Iterator

__all__ = ["InMemoryObjectStore"]


class InMemoryObjectStore:
    def __init__(self) -> None:
        self._objects: dict[str, bytes] = {}

    def get(self, key: str) -> bytes:
        try:
            return self._objects[key]
        except KeyError:
            raise KeyError(f"no such object: {key}") from None

    def put(self, key: str, data: bytes) -> None:
        self._objects[key] = data

    def exists(self, key: str) -> bool:
        return key in self._objects

    def list(self, prefix: str) -> Iterator[str]:
        # Materialised so callers may delete while iterating, which prune does.
        return iter([k for k in sorted(self._objects) if k.startswith(prefix)])

    def delete(self, key: str) -> None:
        self._objects.pop(key, None)

    # -- test affordances ---------------------------------------------------

    def __len__(self) -> int:
        return len(self._objects)

    @property
    def total_bytes(self) -> int:
        return sum(len(v) for v in self._objects.values())
