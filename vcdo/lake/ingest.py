"""Land source records in the raw lake.

The only writer into raw. Everything it stores is immutable and content-addressed
by :class:`~vcdo.lake.store.LakeStore`, so re-observing an unchanged record costs
one manifest rather than a second copy of the payload.

Every landing is measured through the run ledger. ``unaccounted`` must be zero:
records read, minus records stored, minus records deliberately skipped with a
reason, must balance. A non-zero value means rows disappeared without anyone
deciding they should, which is the quiet failure mode this whole layer exists to
prevent.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from vcdo.core.obs_log import ObsLog, run_id
from vcdo.core.run_ledger import stage
from vcdo.lake.store import LakeStore
from vcdo.sources.base import RawRecord, Source, SourceError

__all__ = ["land", "LandingResult"]


@dataclass(frozen=True, slots=True)
class LandingResult:
    source: str
    entity: str
    read: int
    created: int
    unchanged: int
    run_id: str

    @property
    def stored(self) -> int:
        return self.created + self.unchanged


def land(source: Source, entity: str, lake: LakeStore, log: ObsLog) -> LandingResult:
    """Read one entity from ``source`` and store every record in the lake.

    A :class:`SourceError` propagates. It is never converted into a successful
    run with fewer rows -- that is the specific defect this design rejects.
    """
    created = unchanged = read = 0
    current_run = run_id()

    with stage(f"land:{source.name}:{entity}", log) as st:
        for record in source.read(entity):
            read += 1
            result = lake.put(
                record.lake_key(),
                _serialise(record),
                run_id=current_run,
                reason=f"{source.name} {entity} record",
                extra={
                    "source": record.source,
                    "tenant_id": record.tenant_id,
                    "entity": record.entity,
                    "source_record_id": record.source_record_id,
                    "source_updated_at": record.source_updated_at,
                },
            )
            if result.status == "created":
                created += 1
            else:
                unchanged += 1

        st.rows_in(read)
        # `unchanged` counts as stored, not excluded. The record is in the lake;
        # we simply observed it again. Counting it as an exclusion would make a
        # steady-state sync look like it was dropping everything.
        st.rows_out(created + unchanged)

    if read == 0:
        # An entity the inventory expects to have data returning nothing is the
        # HubSpot-403 failure wearing a different hat: a successful run that
        # published an empty table. Refuse to call it a success.
        raise SourceError(
            f"{source.name}/{entity} yielded no records. If that is genuinely correct, "
            "the connection inventory should say so explicitly rather than leaving it "
            "indistinguishable from an auth or scope failure."
        )

    log.finish(
        f"landed {source.name}/{entity}",
        source=source.name,
        entity=entity,
        read=read,
        created=created,
        unchanged=unchanged,
    )
    return LandingResult(source.name, entity, read, created, unchanged, current_run)


def _serialise(record: RawRecord) -> bytes:
    """Serialise deterministically.

    ``sort_keys`` matters: content addressing hashes these bytes, so an unstable
    key order would make every re-observation look like a change and defeat
    deduplication entirely.

    ``ingested_at`` is excluded from the stored body for the same reason -- it
    differs on every run by definition. It lives in the manifest, where it
    belongs, alongside the run id.
    """
    body = {
        "source": record.source,
        "tenant_id": record.tenant_id,
        "entity": record.entity,
        "source_record_id": record.source_record_id,
        "source_updated_at": record.source_updated_at,
        "payload": record.payload,
    }
    return json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
