"""Google Drive: PDF bytes, and the reconciliation that finds deletions.

Two jobs, and the second is the one nothing off the shelf does.

**Copying PDFs** is straightforward: walk the *selected* folders, take files
whose *content* is a PDF, store the original bytes. Identity is the Drive file
id, not the filename — two files called ``invoice.pdf`` in different folders are
different documents, and keying on name would make one silently overwrite the
other.

"Selected" is load-bearing and was, for a while, a lie: the live listing asked
for everything the credential could reach. Against a fixture that is a handful
of files; against a client's credential it is their entire Drive, copied into a
create-only lake that cannot un-copy it. Live mode now refuses to start without
an explicit set of folder ids, and walks them breadth-first because Drive has no
subtree query.

**Finding deletions requires a full inventory comparison.** Drive's change feed
and every connector built on it report *additions and edits*; deletions do not
arrive as a stream you can consume incrementally. So a file removed upstream
simply stops appearing, and an incremental pipeline keeps serving it forever.
The only honest answer is to list the authorised subtree in full and diff it
against what we hold.

That is why this job exists separately from ingestion, and why it must page
properly. The legacy Drive code had **no ``pageToken`` loops at all** — it relied
on ``pageSize`` being large enough, which silently truncates. A truncated listing
in a reconciliation job is worse than no job: every file past the cut looks
deleted.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from vcdo.sources.base import RawRecord, SourceError
from vcdo.sources.mime import is_pdf

__all__ = ["DriveSource", "DriveFile", "Reconciliation", "reconcile", "ENTITIES"]

ENTITIES = ("files",)

#: Drive's own type for native Docs/Sheets/Slides. These have no binary content
#: to copy and no md5; exporting them is a separate, lossy decision.
_GOOGLE_NATIVE_PREFIX = "application/vnd.google-apps."

#: Drive's own type for a folder. Folders are traversed, never stored: they have
#: no content, and treating one as a document would land an empty object.
_FOLDER_MIME = "application/vnd.google-apps.folder"

#: The shape of a Drive file id. Folder ids reach us from connection config and
#: are interpolated into Drive's `q` query, so they are validated, not trusted.
_FOLDER_ID = re.compile(r"[A-Za-z0-9_-]{10,}")

#: Airbyte's Drive connector caps raw file copy at 1 GB. We apply the same limit
#: so behaviour does not change if that path is ever reintroduced, and so a
#: single enormous file cannot stall a sync.
MAX_FILE_BYTES = 1_024 * 1_024 * 1_024


@dataclass(frozen=True, slots=True)
class DriveFile:
    tenant_id: str
    file_id: str
    name: str
    path: str
    mime_type: str
    modified_time: str | None
    md5_checksum: str | None
    data: bytes | None

    def lake_key(self) -> str:
        """Keyed by tenant and Drive file id, never by name.

        Two ``invoice.pdf`` in different folders are different documents, so the
        id is what makes this unique.

        **The tenant leads the key** for the same reason it leads a record key
        (see :mod:`vcdo.sources.base`): without it one customer's documents
        cannot be restricted, restored or erased separately from another's, and
        Drive file ids are only unique within the drive that issued them.

        **The filename is deliberately not in the key.** It was, for legibility,
        but a filename routinely carries a client name -- and an object key is
        the one part of the lake that shows up in listings, logs and error
        messages. It is recorded in the manifest instead, where access is
        controlled.
        """
        return f"drive/{self.tenant_id}/pdf/{self.file_id}"


@dataclass(frozen=True, slots=True)
class Reconciliation:
    """The result of comparing a full upstream listing against what we hold."""

    present: list[str]
    added: list[str]
    changed: list[str]
    tombstoned: list[str]

    @property
    def summary(self) -> str:
        return (
            f"{len(self.present)} present, {len(self.added)} added, "
            f"{len(self.changed)} changed, {len(self.tombstoned)} tombstoned"
        )


class DriveSource:
    name = "drive"

    def __init__(
        self,
        *,
        tenant_id: str,
        mode: str = "mock",
        fixtures_dir: str = "fixtures",
        credentials=None,
        folder_ids: tuple[str, ...] = (),
        listing: str = "files",
    ) -> None:
        self.tenant_id = tenant_id
        self.mode = mode
        self.fixtures_dir = Path(fixtures_dir)
        self._credentials = credentials
        self.folder_ids = tuple(folder_ids)
        self._listing = listing
        if mode == "live" and credentials is None:
            raise SourceError("drive live mode requires OAuth credentials")
        if mode == "live" and not self.folder_ids:
            # An unscoped live listing is not a smaller version of a scoped one:
            # it copies the whole of everything the credential can reach into our
            # lake, which for a client credential is their entire Drive. Refused
            # here because the mistake is unrecoverable -- the lake is
            # create-only, so bytes that should never have been copied cannot be
            # un-copied, only tombstoned.
            raise SourceError(
                "drive live mode requires folder_ids; an unscoped listing copies "
                "everything the credential can reach"
            )
        for folder in self.folder_ids:
            if not _FOLDER_ID.fullmatch(folder):
                # These arrive from operator-chosen connection config and are
                # interpolated into Drive's `q` query, so the shape is checked
                # rather than trusted.
                raise SourceError(f"drive folder id {folder!r} is not a Drive file id")

    def entities(self) -> tuple[str, ...]:
        return ENTITIES

    def read(self, entity: str) -> Iterator[RawRecord]:
        """Metadata records. Bytes are handled by :meth:`pdf_files`."""
        if entity not in ENTITIES:
            raise SourceError(f"unknown drive entity {entity!r}")
        for item in self._listing_items():
            yield RawRecord(
                source=self.name,
                tenant_id=self.tenant_id,
                entity="files",
                source_record_id=str(item.get("id") or ""),
                source_updated_at=item.get("modifiedTime"),
                payload={k: v for k, v in item.items() if not k.startswith("_")},
            )

    def _listing_items(self) -> list[dict]:
        if self.mode == "mock":
            path = self.fixtures_dir / "drive" / f"{self._listing}.json"
            if not path.exists():
                raise SourceError(f"no drive fixture at {path}")
            data = json.loads(path.read_text())
            files = data.get("files")
            if not isinstance(files, list):
                raise SourceError(f"fixture {path} has no 'files' list")
            return [f for f in files if not f.get("trashed")]
        return list(self._live_listing())

    def _live_listing(self) -> Iterator[dict]:
        """Walk the selected folders, breadth-first, paging properly.

        Drive has **no subtree query**: ``'<id>' in parents`` matches direct
        children only, so reaching a nested file means walking level by level.
        The alternative -- listing everything the credential can reach and
        filtering afterwards -- is what this replaces, and it copied the whole of
        a client's Drive.

        ``pageSize`` alone truncates silently. In a reconciliation job that means
        every file past the cut is reported deleted, so the page loop is
        mandatory at every level, not just the first.

        Folders already visited are skipped: a file can have several parents and
        a shortcut can point back up, so an unguarded walk does not terminate.
        """
        from googleapiclient.discovery import build

        service = build("drive", "v3", credentials=self._credentials, cache_discovery=False)
        fields = "nextPageToken, files(id, name, mimeType, parents, modifiedTime, size, md5Checksum, trashed)"

        pending = list(self.folder_ids)
        visited: set[str] = set()
        try:
            while pending:
                folder = pending.pop()
                if folder in visited:
                    continue
                visited.add(folder)

                page_token = None
                while True:
                    response = (
                        service.files()
                        .list(
                            q=f"'{folder}' in parents and trashed = false",
                            fields=fields,
                            pageSize=1000,
                            pageToken=page_token,
                            includeItemsFromAllDrives=True,
                            supportsAllDrives=True,
                        )
                        .execute()
                    )
                    for item in response.get("files", []):
                        if item.get("mimeType") == _FOLDER_MIME:
                            pending.append(str(item["id"]))
                        else:
                            yield item
                    page_token = response.get("nextPageToken")
                    if not page_token:
                        break
        except Exception as exc:
            # Never yield a partial listing: reconcile() treats what it is given
            # as complete, so a truncated walk reports live files as deleted.
            raise SourceError(f"drive listing failed: {exc}") from exc

    def pdf_files(self) -> Iterator[DriveFile]:
        """Every PDF in the authorised subtree, with its bytes.

        Google-native documents are skipped: they have no binary content, and
        exporting them produces a *different* artifact, not a copy. Conflating
        the two would put a generated PDF in the raw lake labelled as the
        original document.
        """
        for item in self._listing_items():
            mime = str(item.get("mimeType") or "")
            if mime.startswith(_GOOGLE_NATIVE_PREFIX):
                continue

            data = self._content(item)
            if data is None:
                continue
            if len(data) > MAX_FILE_BYTES:
                raise SourceError(
                    f"drive file {item.get('id')} is {len(data)} bytes, over the "
                    f"{MAX_FILE_BYTES} limit; route it to a documented downloader"
                )
            if not is_pdf(data, declared_mime=mime, filename=item.get("name")):
                continue

            yield DriveFile(
                tenant_id=self.tenant_id,
                file_id=str(item["id"]),
                name=str(item.get("name") or ""),
                path=str(item.get("_path") or item.get("name") or ""),
                mime_type=mime,
                modified_time=item.get("modifiedTime"),
                md5_checksum=item.get("md5Checksum"),
                data=data,
            )

    def _content(self, item: dict) -> bytes | None:
        if self.mode == "mock":
            fixture = item.get("_fixture")
            if not fixture:
                return None
            return (self.fixtures_dir / "pdf" / fixture).read_bytes()

        import io

        from googleapiclient.discovery import build
        from googleapiclient.http import MediaIoBaseDownload

        service = build("drive", "v3", credentials=self._credentials, cache_discovery=False)
        buffer = io.BytesIO()
        request = service.files().get_media(fileId=item["id"], supportsAllDrives=True)
        downloader = MediaIoBaseDownload(buffer, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buffer.getvalue()


def verify_against_drive_md5(data: bytes, md5_checksum: str | None) -> bool:
    """Cross-check downloaded bytes against Drive's own checksum.

    Free and independent: it catches a truncated or corrupted transfer that our
    own SHA-256 would happily hash without complaint, because a hash of the wrong
    bytes is still a valid hash.
    """
    if not md5_checksum:
        return True  # not offered for this file; absence is not a mismatch
    return hashlib.md5(data).hexdigest() == md5_checksum


def reconcile(
    upstream_ids: set[str],
    held_ids: set[str],
    changed_ids: set[str] | None = None,
) -> Reconciliation:
    """Compare a FULL upstream listing against what the lake holds.

    ``upstream_ids`` must be a complete listing of the authorised scope. A partial
    one makes every missing file look deleted, which is why the listing loop pages
    properly and why a failed listing must raise rather than return what it got.
    """
    return Reconciliation(
        present=sorted(upstream_ids & held_ids),
        added=sorted(upstream_ids - held_ids),
        changed=sorted(changed_ids or set()),
        # Held but no longer upstream. Tombstoned, not deleted: the raw bytes
        # stay in the lake as evidence of what was once there, and only the
        # serving layer stops showing it.
        tombstoned=sorted(held_ids - upstream_ids),
    )
