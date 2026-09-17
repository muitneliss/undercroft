"""PDF extraction from email must be decided by content, and must not lie about failure.

Every case here is one the handoff's acceptance table names, plus the two the
legacy system measured: attachments arriving as application/octet-stream, and
Gmail's attachmentId being unusable as an identity.
"""

import json
from pathlib import Path

import pytest

from vcdo.sources.gmail import GmailSource
from vcdo.sources.mime import attachment_parts, decode_base64url, is_pdf, looks_truncated, sniff

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures"


@pytest.fixture
def messages():
    return json.loads((FIXTURES / "gmail" / "messages.json").read_text())["messages"]


@pytest.fixture
def source():
    # Our tenant is a CASE-ID; the mailbox is a separate field. They were one
    # field, which is how an email address ended up in every attachment's key.
    return GmailSource(
        tenant_id="CASE-001",
        mailbox="mailbox@vietcham.example",
        mode="mock",
        fixtures_dir=str(FIXTURES),
    )


def outcomes_for(source, messages, message_id):
    message = next(m for m in messages if m["id"] == message_id)
    return source.extract_attachments(message)


# -- content decides ---------------------------------------------------------


def test_an_inline_pdf_attachment_is_stored(source, messages):
    stored = [o for o in outcomes_for(source, messages, "msg-0001") if o.status == "stored"]

    assert len(stored) == 1
    assert stored[0].attachment.filename == "receipt.pdf"
    assert stored[0].attachment.data.startswith(b"%PDF-")


def test_a_pdf_declared_octet_stream_is_still_stored(source, messages):
    """The legacy system found 39 real PDFs arriving this way and skipping them."""
    stored = [o for o in outcomes_for(source, messages, "msg-0002") if o.status == "stored"]

    assert len(stored) == 1
    assert stored[0].attachment.filename == "statement.pdf"
    assert stored[0].attachment.declared_mime == "application/octet-stream"


def test_a_zip_named_pdf_is_excluded(source, messages):
    """Extension is attacker-controlled and routinely wrong even without malice."""
    outs = outcomes_for(source, messages, "msg-0006")

    assert [o.status for o in outs] == ["skipped_not_pdf"]
    assert "zip" in outs[0].reason


def test_nested_multipart_attachments_are_found(source, messages):
    """A single-level scan silently misses everything below the first layer."""
    message = next(m for m in messages if m["id"] == "msg-0002")
    parts = attachment_parts(message["payload"])

    assert [p.filename for p in parts] == ["statement.pdf"]


# -- failure is reported, never counted as success ---------------------------


def test_a_corrupt_pdf_is_failed_not_stored_and_not_skipped(source, messages):
    """Three states, not two. Corrupt is neither stored nor legitimately skipped;
    collapsing it into either hides a real problem."""
    outs = outcomes_for(source, messages, "msg-0005")

    assert [o.status for o in outs] == ["failed_corrupt"]


def test_a_drive_link_produces_no_attachment_at_all(source, messages):
    """Handoff case: a link is not an attachment."""
    assert outcomes_for(source, messages, "msg-0003") == []


# -- identity ----------------------------------------------------------------


def test_the_same_filename_in_two_messages_stays_distinguishable(source, messages):
    """Both are receipt.pdf; they must not collide in the lake."""
    a = [o for o in outcomes_for(source, messages, "msg-0001") if o.status == "stored"][0]
    b = [o for o in outcomes_for(source, messages, "msg-0004") if o.status == "stored"][0]

    assert a.attachment.filename == b.attachment.filename == "receipt.pdf"
    assert a.attachment.lake_key() != b.attachment.lake_key()
    assert a.attachment.data != b.attachment.data


def test_the_lake_key_contains_no_server_assigned_id(source, messages):
    """Gmail regenerates attachmentId on every fetch -- 0 of 114 matched across two
    identical runs in the legacy system. An id that changes cannot be an
    idempotency key."""
    a = [o for o in outcomes_for(source, messages, "msg-0001") if o.status == "stored"][0]
    key = a.attachment.lake_key()

    assert "msg-0001" in key
    # part id is positional, so it is stable across fetches
    assert key.endswith(f"/{a.attachment.part_id}")
    assert a.attachment.part_id


def test_the_lake_key_names_the_tenant_and_not_the_person(source, messages):
    """An object key surfaces in listings, logs and errors; a mailbox address is PII.

    The address and the filename are still recorded in the manifest, where access
    is controlled -- they are removed from the key, not lost.
    """
    a = [o for o in outcomes_for(source, messages, "msg-0001") if o.status == "stored"][0]
    key = a.attachment.lake_key()

    assert key.startswith(f"gmail/{a.attachment.tenant_id}/")
    assert "@" not in key
    assert "receipt.pdf" not in key
    assert a.attachment.filename == "receipt.pdf"


def test_extraction_is_deterministic(source, messages):
    """Same message, same bytes, same key -- twice. Without this, replay duplicates."""
    first = outcomes_for(source, messages, "msg-0001")
    second = outcomes_for(source, messages, "msg-0001")

    assert [o.attachment.lake_key() for o in first if o.attachment] == [
        o.attachment.lake_key() for o in second if o.attachment
    ]


# -- the sniffing primitives -------------------------------------------------


def test_sniff_identifies_by_leading_bytes():
    assert sniff(b"%PDF-1.4 ...") == "pdf"
    assert sniff(b"PK\x03\x04...") == "zip"
    assert sniff(b"nothing recognisable") is None
    assert sniff(b"") is None
    assert sniff(None) is None


def test_a_zip_is_reported_as_zip_not_guessed_as_docx():
    """docx, xlsx and pptx are all ZIP containers. Guessing routes a spreadsheet
    to a document extractor."""
    assert sniff(b"PK\x03\x04word/document.xml") == "zip"


def test_a_truncated_pdf_is_detected():
    assert looks_truncated(b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog") is True
    assert looks_truncated((FIXTURES / "pdf" / "gmail_receipt.pdf").read_bytes()) is False


def test_a_tiny_pdf_stub_is_not_accepted_as_a_document():
    assert is_pdf(b"%PDF-") is False


def test_base64url_decodes_without_padding():
    """Gmail omits '='. Without re-adding it, decoding raises and the attachment
    is silently skipped."""
    assert decode_base64url("aGVsbG8") == b"hello"
    assert decode_base64url("") is None
    assert decode_base64url("!!!not base64!!!") is None
