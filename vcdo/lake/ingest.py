"""Land source records in the raw lake.

The only writer into raw. Everything it stores is immutable and content-addressed
by :class:`~vcdo.lake.store.LakeStore`, so re-observing an unchanged record costs
one manifest rather than a second copy of the payload.

Landings are no longer measured through a run ledger; see ADR 0007 for that
removal and what it gives up. Two guards survive it and are the reason a silent
shortfall still cannot pass unnoticed *here*:

- :class:`SourceError` propagates. A failed read is never converted into a
  successful run with fewer rows.
- An entity that yields **zero** records raises. A source returning nothing is
  the HubSpot-403 failure wearing a different hat -- a green run that published
  an empty table -- so it is refused rather than reported as a success.

What is gone is the *arithmetic*: nothing now checks that records read minus
records stored minus records skipped balances to zero. A partial shortfall, as
opposed to a total one, is no longer detected.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from vcdo.core.obs_log import ObsLog, run_id
from vcdo.lake.store import LakeStore
from vcdo.sources.base import RawRecord, Source, SourceError

__all__ = ["land", "LandingResult", "land_gmail_attachments", "land_drive_pdfs", "DocumentResult"]


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


@dataclass(frozen=True, slots=True)
class DocumentResult:
    stored: int
    unchanged: int
    skipped: int
    failed: int
    run_id: str


def land_gmail_attachments(source, lake: LakeStore, log: ObsLog) -> DocumentResult:
    """Extract and store PDF attachments from Gmail messages.

    Separate from the message landing on purpose. A successful message sync is
    NOT evidence that its attachments exist as objects -- the handoff says so,
    and it is the failure that hides best, because message counts look healthy
    while documents are quietly missing.
    """
    current_run = run_id()
    stored = unchanged = skipped = failed = 0

    messages = list(source.read("messages"))

    for record in messages:
        for outcome in source.extract_attachments(record.payload):
            if outcome.status == "skipped_not_pdf":
                skipped += 1
                continue
            if outcome.status == "failed_corrupt":
                failed += 1
                log.swallowed(
                    "attachment failed",
                    message_id=record.source_record_id,
                    reason=outcome.reason,
                )
                continue

            att = outcome.attachment
            result = lake.put(
                att.lake_key(),
                att.data,
                run_id=current_run,
                reason="gmail pdf attachment",
                extra={
                    "source": "gmail",
                    # The tenant is in the key too, but a manifest that can
                    # only be attributed by parsing its own key cannot answer
                    # "erase this customer" without a full scan.
                    "tenant_id": att.tenant_id,
                    "mailbox": att.mailbox,
                    "message_id": att.message_id,
                    "part_id": att.part_id,
                    "filename": att.filename,
                    "declared_mime": att.declared_mime,
                },
            )
            if result.status == "created":
                stored += 1
            else:
                unchanged += 1

    if failed:
        # Surfaced, never folded into a success count. The handoff is explicit
        # that a corrupt item must not be reported as ingested.
        log.error("gmail attachments failed", failed=failed, stored=stored)

    log.finish(
        "landed gmail attachments",
        stored=stored,
        unchanged=unchanged,
        skipped=skipped,
        failed=failed,
    )
    return DocumentResult(stored, unchanged, skipped, failed, current_run)


def land_drive_pdfs(source, lake: LakeStore, log: ObsLog) -> DocumentResult:
    """Copy Drive PDFs into the lake, verifying against Drive's own checksum."""
    from vcdo.sources.drive import verify_against_drive_md5

    current_run = run_id()
    stored = unchanged = failed = 0

    files = list(source.pdf_files())

    for f in files:
        if not verify_against_drive_md5(f.data, f.md5_checksum):
            # An independent check: our own SHA-256 would hash truncated
            # bytes without complaint, because a hash of the wrong bytes is
            # still a valid hash.
            failed += 1
            log.error("drive checksum mismatch", file_id=f.file_id, reason="md5 does not match Drive")
            continue

        result = lake.put(
            f.lake_key(),
            f.data,
            run_id=current_run,
            reason="drive pdf copy",
            extra={
                "source": "drive",
                "tenant_id": f.tenant_id,
                "drive_file_id": f.file_id,
                "name": f.name,
                "path": f.path,
                "modified_time": f.modified_time,
                "md5_checksum": f.md5_checksum,
            },
        )
        if result.status == "created":
            stored += 1
        else:
            unchanged += 1

    log.finish("landed drive pdfs", stored=stored, unchanged=unchanged, failed=failed)
    return DocumentResult(stored, unchanged, 0, failed, current_run)
