"""Backup and restore.

**A backup nobody has restored is a hypothesis.** The restore path is therefore
the primary artifact here, and it is exercised by a test that restores into a
clean database and checks the rows came back — not by a test that asserts a file
was written.

What is in the backup set, and why:

``curated`` / ``ops`` / ``dq``
    Projections, and cheap to rebuild from raw — but rebuilding takes a pipeline
    run and the raw lake being reachable. Backing them up turns a recovery from
    "re-run everything and hope the sources agree" into a restore.

``app``
    **Not a projection.** Tenants, users, memberships and sealed credentials
    exist nowhere else; losing this schema means every customer reconnects every
    source by hand. It is the one entry here that would be unrecoverable, which
    is exactly why it is named rather than assumed.

    The master key that opens ``app.connection_secret`` is deliberately *not*
    in this dump. A dump restored without it holds rows nobody can read; a dump
    stored beside it holds encryption that buys nothing. Back the key up
    separately — see ADR 0005.

Metabase's application database
    **Business content, not a cache.** It holds the questions, dashboards and
    permissions someone authored. Losing it loses work that exists nowhere else,
    and `vcdo provision-bi` recreates only the connection and the checked-in
    dashboard, not anything added since.

Kestra's metadata database
    Execution history and schedule state. Restoring it alongside the curated
    layer would roll the scheduler back in time, so it is backed up separately
    and restored deliberately — see the note in the compose file.

The raw lake is **not** covered here. It is object storage with its own
durability story, it is far larger than everything else combined, and it is the
one layer that cannot be regenerated — so it wants object-level versioning and a
replication policy, not a nightly dump. Recorded as an explicit gap rather than
quietly omitted.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

__all__ = ["dump", "restore", "BackupResult", "BACKUP_SCHEMAS"]

#: Schemas included in a curated backup. Metabase and Kestra have their own
#: databases and are dumped separately.
BACKUP_SCHEMAS = ("curated", "ops", "dq", "app")


@dataclass(frozen=True, slots=True)
class BackupResult:
    path: Path
    bytes: int
    schemas: tuple[str, ...]
    taken_at: str


def dump(dsn: str, out_dir: str | Path, *, schemas: tuple[str, ...] = BACKUP_SCHEMAS) -> BackupResult:
    """Dump the curated schemas with ``pg_dump``.

    Custom format (``-Fc``), not plain SQL: it restores selectively, in parallel,
    and refuses to apply to an incompatible target rather than half-executing a
    script and leaving a database in a state nobody designed.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    taken_at = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    path = out / f"curated-{taken_at}.dump"

    args = ["pg_dump", "--format=custom", "--no-owner", "--no-privileges", f"--file={path}"]
    for schema in schemas:
        args += ["--schema", schema]
    args.append(dsn)

    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"pg_dump failed: {result.stderr.strip()[:500]}")

    size = path.stat().st_size
    if size == 0:
        # An empty dump file is the failure mode that looks like success: the
        # job is green, the file exists, and the restore finds nothing.
        raise RuntimeError(f"pg_dump produced an empty file at {path}")

    return BackupResult(path, size, schemas, taken_at)


def restore(dsn: str, dump_path: str | Path, *, clean: bool = True) -> None:
    """Restore a dump into ``dsn``.

    ``clean`` drops the objects before recreating them, so a restore onto a
    non-empty database is a replacement rather than a merge. A merge would leave
    rows from two different generations side by side, which is worse than either
    one alone and very hard to spot.
    """
    args = ["pg_restore", "--no-owner", "--no-privileges", "--dbname", dsn]
    if clean:
        args += ["--clean", "--if-exists"]
    args.append(str(dump_path))

    result = subprocess.run(args, capture_output=True, text=True)
    # pg_restore exits non-zero on warnings that are routinely benign (a DROP of
    # something absent, for instance). Treat stderr as the signal only when the
    # exit code indicates a real failure.
    if result.returncode != 0:
        stderr = result.stderr.strip()
        if "ERROR" in stderr:
            raise RuntimeError(f"pg_restore failed: {stderr[:800]}")
