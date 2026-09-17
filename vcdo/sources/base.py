"""The source seam: one shape for every source, in both mock and live mode.

A source yields :class:`RawRecord`. That is the entire contract. Whether the
records came from a live API or a recorded fixture is invisible above this line,
which is what makes `mock` a real mode rather than a test affordance (ADR 0002).

The envelope fields are not decoration. Each one answers a question that gets
asked during an incident:

- ``source`` / ``tenant_id`` --- which system, and *whose* data. A record without
  a tenant cannot be safely deleted, restored, or access-controlled.
- ``entity`` --- which stream, so raw stays source-separated.
- ``source_record_id`` --- the upstream identity, for idempotent upserts.
- ``source_updated_at`` --- when the *source* last changed it.
- ``ingested_at`` --- when *we* saw it.
- ``run_id`` --- which run produced it, so every curated row traces to a run.

`source_updated_at` and `ingested_at` are deliberately separate. Collapsing them
makes late-arriving data indistinguishable from recently-changed data, and the
two demand opposite handling: a late record must not overwrite a newer one.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

__all__ = ["RawRecord", "Source", "SourceError"]


class SourceError(Exception):
    """A source could not produce its records.

    Always raised rather than returning an empty iterator. The legacy system had
    a HubSpot 403 silently produce an empty staging table, which published as a
    successful run with zero rows -- indistinguishable downstream from a customer
    who genuinely has no data.
    """


@dataclass(frozen=True, slots=True)
class RawRecord:
    source: str
    tenant_id: str
    entity: str
    source_record_id: str
    payload: dict[str, Any]
    source_updated_at: str | None = None
    ingested_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    def __post_init__(self) -> None:
        # Identity is checked here because a record with no id cannot be upserted,
        # deduplicated, or traced -- and the cheapest place to find that out is
        # before it reaches the lake, not during a curated merge.
        if not self.source_record_id:
            raise ValueError(f"{self.source}/{self.entity} record has no source_record_id")

    def lake_key(self) -> str:
        """Where this record's observation lives in the raw lake.

        Keyed by upstream identity rather than by run, so re-observing an
        unchanged record is recognised as unchanged instead of accumulating a
        copy per run.

        **The tenant is part of the key.** Source record ids are only unique
        within a tenant: two Xero organisations, or two mailboxes, will happily
        both have an invoice ``INV-001``. Omitting the tenant makes those two
        records the same lake object, so one silently overwrites the other and
        two customers' data merge. That is also why deletion and access control
        need it -- you cannot restrict or erase one tenant's raw data if it is
        interleaved with another's under a shared key.
        """
        return f"records/{self.source}/{self.tenant_id}/{self.entity}/{self.source_record_id}"


class Source(Protocol):
    """Anything that yields raw records.

    Implementations must raise :class:`SourceError` on failure rather than
    yielding nothing.
    """

    name: str
    tenant_id: str

    def entities(self) -> tuple[str, ...]: ...

    def read(self, entity: str) -> Iterator[RawRecord]: ...
