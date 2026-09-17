"""MIME traversal and content sniffing for email attachments.

**Detect by magic bytes, not by MIME type and not by filename.** The legacy
system found 39 attachments arriving as ``application/octet-stream`` that were
genuine PDFs and were being skipped. Filename extension is worse still: it is
attacker-controlled and routinely wrong even without malice.

The handoff asks for "MIME type and/or validated PDF signature". Measured
reality is that the declared type alone is insufficient, so content wins and the
declared type is only a hint.

MIME structure is traversed recursively. Attachments nest arbitrarily deep --
``multipart/mixed`` containing ``multipart/alternative`` containing a forwarded
``message/rfc822`` with its own attachments -- and a single-level scan silently
misses everything below the first layer.
"""

from __future__ import annotations

import base64
import binascii
from collections.abc import Iterator
from dataclasses import dataclass

__all__ = ["MimePart", "walk_parts", "sniff", "decode_base64url", "is_pdf", "attachment_parts"]

#: Magic byte signatures. Keys are the leading bytes; values the extension.
#:
#: ZIP is deliberately ambiguous -- docx, xlsx and pptx are all ZIP containers --
#: so it is reported as `zip` rather than guessed at. Guessing here would label
#: a spreadsheet as a document and route it to the wrong extractor.
_MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"%PDF-", "pdf"),
    (b"PK\x03\x04", "zip"),
    (b"\xd0\xcf\x11\xe0", "ole"),  # legacy .doc/.xls/.msg
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
    (b"GIF8", "gif"),
    (b"Rar!\x1a\x07", "rar"),
    (b"7z\xbc\xaf\x27\x1c", "7z"),
    (b"{\\rtf", "rtf"),
    (b"BEGIN:VCALENDAR", "ics"),
)

#: The smallest thing that can still be a valid PDF. Anything shorter is a stub
#: or a truncation, never a document.
_MIN_PDF_BYTES = 64


@dataclass(frozen=True, slots=True)
class MimePart:
    part_id: str
    filename: str | None
    mime_type: str | None
    data: bytes | None
    #: Present when Gmail supplied an id instead of inline data. Recorded for
    #: provenance only -- never used as an identity key, because Gmail
    #: regenerates it on every fetch (0 of 114 matched across two identical runs
    #: in the legacy system).
    attachment_id: str | None = None


def walk_parts(payload: dict, prefix: str = "") -> Iterator[tuple[str, dict]]:
    """Yield ``(part_id, part)`` for every part, depth-first.

    ``part_id`` is positional (``0``, ``0.1``, ``0.1.2``) and therefore stable
    across fetches, unlike Gmail's server-assigned ``attachmentId``. It is what
    makes an attachment idempotently addressable.
    """
    parts = payload.get("parts")
    if not parts:
        yield (prefix or "0", payload)
        return
    for index, part in enumerate(parts):
        child = f"{prefix}.{index}" if prefix else str(index)
        yield from walk_parts(part, child)


def attachment_parts(payload: dict) -> list[MimePart]:
    """Every part that carries a file, at any nesting depth."""
    found = []
    for part_id, part in walk_parts(payload):
        body = part.get("body") or {}
        filename = (part.get("filename") or "").strip() or None
        data = body.get("data")
        attachment_id = body.get("attachmentId")

        # A part with neither a filename nor an attachment id is body text.
        if not filename and not attachment_id:
            continue

        found.append(
            MimePart(
                part_id=part_id,
                filename=filename,
                mime_type=part.get("mimeType"),
                data=decode_base64url(data) if data else None,
                attachment_id=attachment_id,
            )
        )
    return found


def decode_base64url(data: str | None) -> bytes | None:
    """Decode Gmail's base64url body data.

    Gmail omits the ``=`` padding. Without re-adding it, decoding raises and an
    attachment is silently skipped as unreadable.
    """
    if not data:
        return None
    try:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))
    except (binascii.Error, ValueError):
        return None


def sniff(blob: bytes | None) -> str | None:
    """Identify content by its leading bytes. ``None`` when unrecognised."""
    if not blob:
        return None
    for signature, extension in _MAGIC:
        if blob.startswith(signature):
            return extension
    return None


def is_pdf(blob: bytes | None, *, declared_mime: str | None = None, filename: str | None = None) -> bool:
    """Decide whether these bytes are a PDF.

    Content decides. ``declared_mime`` and ``filename`` are accepted so callers
    can pass what they know, but neither can promote a non-PDF: a file named
    ``.pdf`` holding a ZIP is a ZIP, and a real PDF declared
    ``application/octet-stream`` is still a PDF.
    """
    if sniff(blob) != "pdf":
        return False
    # Magic bytes alone are not enough -- a truncated download starts with
    # `%PDF-` and is not a document. Length is a cheap, honest floor; full
    # structural validation belongs to the extraction step, not to ingestion.
    return blob is not None and len(blob) >= _MIN_PDF_BYTES


def looks_truncated(blob: bytes | None) -> bool:
    """A PDF that begins correctly but has no end marker.

    Reported as a failed item rather than stored as complete. The handoff is
    explicit that a corrupt attachment must not be counted as ingested.
    """
    if not blob or sniff(blob) != "pdf":
        return False
    return b"%%EOF" not in blob[-2048:]
