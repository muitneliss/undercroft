"""Gmail: message metadata, and the attachment-bytes worker.

Two outputs from one fetch. Messages become records in the raw lake; attachments
become *objects* in the raw lake. They are separate datasets with separate
prefixes, and a successful message sync does **not** mean attachment ingestion
succeeded — the handoff is explicit, and it is the failure that matters most,
because message counts look healthy while documents are silently missing.

**Attachment identity never uses Gmail's ``attachmentId``.** Gmail regenerates it
on every fetch: the legacy system measured 0 of 114 matching across two identical
runs. An id that changes cannot be an idempotency key, cannot dedupe, and cannot
be dereferenced later. Identity here is ``(tenant_id, message_id, part_id)`` plus
the SHA-256 of the bytes — all derivable without any server-assigned value.

Identity used to lead with the *mailbox* and end with the *filename*. Both were
removed from the key: an address and an attachment name are personal data, and an
object key is the one part of the lake that appears in listings, logs and error
messages. Neither carried uniqueness the tenant and positional part id do not
already carry. Both are still recorded in the manifest.

That is why live mode fetches ``format="raw"``/``full`` once per message and
extracts bytes locally rather than making a second ``attachments.get`` call. One
read per message, and the frozen payload is the evidence for both datasets.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from vcdo.sources.base import RawRecord, SourceError
from vcdo.sources.mime import attachment_parts, is_pdf, looks_truncated, sniff

__all__ = ["GmailSource", "Attachment", "AttachmentOutcome", "ENTITIES"]

ENTITIES = ("messages",)


@dataclass(frozen=True, slots=True)
class Attachment:
    tenant_id: str
    mailbox: str
    message_id: str
    part_id: str
    filename: str | None
    declared_mime: str | None
    data: bytes

    def lake_key(self) -> str:
        """Positional and stable. Never contains a server-assigned id.

        **Keyed by tenant, not by mailbox.** The mailbox is a person's email
        address, and an object key is the one part of the lake that surfaces in
        listings, logs and error messages; the tenant CASE-ID says the same thing
        about ownership without naming anyone. The address itself is recorded in
        the manifest, where access is controlled. There is exactly one Gmail
        connection per tenant (``ops.connection`` is keyed ``(tenant_id,
        source)``), so this is no less unique than the address was.

        **The filename is not in the key either.** It carried no uniqueness --
        ``part_id`` is positional and already unique within a message -- and
        attachment filenames routinely contain client names.
        """
        return f"gmail/{self.tenant_id}/attachments/{self.message_id}/{self.part_id}"


@dataclass(frozen=True, slots=True)
class AttachmentOutcome:
    """What happened to one candidate part.

    ``status`` is one of ``stored``, ``skipped_not_pdf``, or ``failed_corrupt``.
    Three states, not two: a corrupt file is neither successfully stored nor
    legitimately skipped, and collapsing it into either one hides a real problem.
    """

    status: str
    reason: str
    attachment: Attachment | None = None


class GmailSource:
    name = "gmail"

    def __init__(
        self,
        *,
        tenant_id: str,
        mode: str = "mock",
        fixtures_dir: str = "fixtures",
        credentials=None,
        mailbox: str = "",
    ) -> None:
        self.tenant_id = tenant_id
        #: The mailbox address this connection reads. Public, and deliberately
        #: separate from ``tenant_id``: one names the customer whose lake this
        #: is, the other names a person. They were the same field, which put an
        #: email address into every attachment's object key.
        self.mailbox = mailbox
        self.mode = mode
        self.fixtures_dir = Path(fixtures_dir)
        self._credentials = credentials
        if mode == "live" and credentials is None:
            raise SourceError("gmail live mode requires OAuth credentials")
        if mode == "live" and not mailbox:
            # Live reads use userId="me", so the mailbox is whatever the
            # credential happens to be. Recording which one we believe it is
            # makes a mis-connected account visible instead of silent.
            raise SourceError("gmail live mode requires mailbox (the address the credential reads)")

    def entities(self) -> tuple[str, ...]:
        return ENTITIES

    def read(self, entity: str) -> Iterator[RawRecord]:
        if entity not in ENTITIES:
            raise SourceError(f"unknown gmail entity {entity!r}")
        for message in self._messages():
            yield RawRecord(
                source=self.name,
                tenant_id=self.tenant_id,
                entity="messages",
                source_record_id=str(message.get("id") or ""),
                # internalDate is Gmail's own clock in epoch milliseconds. The
                # `Date:` header is the SENDER's clock and is routinely wrong or
                # forged, so ordering and windows must never use it.
                source_updated_at=_epoch_ms_to_iso(message.get("internalDate")),
                payload=message,
            )

    def _messages(self) -> list[dict]:
        if self.mode == "mock":
            path = self.fixtures_dir / "gmail" / "messages.json"
            if not path.exists():
                raise SourceError(f"no gmail fixture at {path}")
            data = json.loads(path.read_text())
            messages = data.get("messages")
            if not isinstance(messages, list):
                raise SourceError(f"fixture {path} has no 'messages' list")
            return messages
        return list(self._live_messages())

    def _live_messages(self) -> Iterator[dict]:
        """Fetch each message once, in full. No second attachments.get call."""
        from googleapiclient.discovery import build

        service = build("gmail", "v1", credentials=self._credentials, cache_discovery=False)
        try:
            page_token = None
            while True:
                listing = (
                    service.users()
                    .messages()
                    .list(userId="me", maxResults=500, pageToken=page_token)
                    .execute()
                )
                for stub in listing.get("messages", []):
                    yield (
                        service.users().messages().get(userId="me", id=stub["id"], format="full").execute()
                    )
                page_token = listing.get("nextPageToken")
                if not page_token:
                    break
        except Exception as exc:
            raise SourceError(f"gmail read failed: {exc}") from exc

    # -- the attachment worker ------------------------------------------------

    def extract_attachments(self, message: dict) -> list[AttachmentOutcome]:
        """Pull PDF bytes out of an already-fetched message.

        Pure with respect to the network in mock mode and in live mode alike:
        the bytes arrived with the message. That is what lets attachments be
        rebuilt from the frozen lake rather than re-fetched.
        """
        message_id = str(message.get("id") or "")
        outcomes: list[AttachmentOutcome] = []

        for part in attachment_parts(message.get("payload") or {}):
            if part.data is None:
                # Gmail supplied an id instead of inline bytes. We do not chase
                # it: the id is already stale. Recorded as a failure so it is
                # visible rather than silently absent.
                outcomes.append(
                    AttachmentOutcome(
                        "failed_corrupt",
                        f"part {part.part_id} carried no inline data "
                        f"(attachmentId is not usable as an identity)",
                    )
                )
                continue

            if looks_truncated(part.data):
                outcomes.append(
                    AttachmentOutcome(
                        "failed_corrupt",
                        f"{part.filename!r} begins with %PDF- but has no end marker",
                    )
                )
                continue

            if not is_pdf(part.data, declared_mime=part.mime_type, filename=part.filename):
                outcomes.append(
                    AttachmentOutcome(
                        "skipped_not_pdf",
                        f"{part.filename!r} is {sniff(part.data) or 'unrecognised'}, "
                        f"declared {part.mime_type!r}",
                    )
                )
                continue

            outcomes.append(
                AttachmentOutcome(
                    "stored",
                    "pdf confirmed by content",
                    Attachment(
                        tenant_id=self.tenant_id,
                        mailbox=self.mailbox,
                        message_id=message_id,
                        part_id=part.part_id,
                        filename=part.filename,
                        declared_mime=part.mime_type,
                        data=part.data,
                    ),
                )
            )
        return outcomes


def _epoch_ms_to_iso(value: object) -> str | None:
    from datetime import UTC, datetime

    if value in (None, ""):
        return None
    try:
        return datetime.fromtimestamp(int(value) / 1000, tz=UTC).isoformat()
    except (TypeError, ValueError):
        return None
