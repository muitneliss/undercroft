"""Structured JSONL logging with a run identity that survives process boundaries.

Every line carries six mandatory fields. They are mandatory because a log that is
sometimes structured is unqueryable: one handler emitting a bare string forces
every consumer to handle both shapes, and in practice consumers handle neither.

The run id is generated once per process and exported into the environment, so a
subprocess inherits it rather than inventing its own. Without that, a pipeline
made of several programs produces several unrelated run ids and nothing can be
traced end to end --- which is exactly when you need to.

That inheritance is right for a one-shot CLI process and *wrong* for the
long-lived worker, which serves many runs. Caching forever meant two tenants
synced by the same process shared a run id --- and the run id is stamped into
every raw lake manifest, every curated row, every quarantine record and every
gate finding. Sharing one across tenants makes "which run wrote this object"
unanswerable, which is the question provenance exists to answer.

:func:`new_run_id` exists for that boundary: a server starts each run with a
fresh id, and subprocesses of that run still inherit it.

Every line also carries ``tenant_id``, for the same reason the raw lake puts the
tenant in its key --- a log that cannot be attributed to a customer cannot answer
"what happened to their data", and cannot be filtered out when they leave.

**Never log data values.** Not email bodies, not customer names, not amounts, not
tokens. Logs travel further and live longer than the data they describe, and a
log line is the easiest way for PII to escape the systems designed to hold it.
Log identifiers, counts and reasons; the data stays in the lake.
"""

from __future__ import annotations

import fcntl
import json
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

__all__ = ["run_id", "new_run_id", "log", "ObsLog", "REQUIRED_FIELDS"]

REQUIRED_FIELDS = ("ts", "level", "component", "run_id", "tenant_id", "event", "message")

_RUN_ID_ENV = "VCDO_RUN_ID"

#: Keys whose values are never written, whatever a caller passes. This is a
#: backstop, not the policy -- the policy is "don't log data". But a backstop
#: costs nothing and the one time it fires, it prevents a token in a log file.
_REDACTED = frozenset(
    {"password", "secret", "token", "api_key", "access_token", "refresh_token", "authorization"}
)


def run_id() -> str:
    """Return this run's id, creating and exporting it on first call.

    Exported to the environment so child processes inherit it. ``subprocess`` is
    the only channel available, and an explicit argument would have to be
    threaded through every call site --- which means it would be forgotten.
    """
    existing = os.environ.get(_RUN_ID_ENV, "").strip()
    if existing:
        return existing
    return new_run_id()


def new_run_id() -> str:
    """Start a new run: generate an id and export it, replacing any current one.

    For callers that serve *many* runs from one process -- the worker's trigger
    server, above all. :func:`run_id` deliberately never regenerates, so without
    this every run in a long-lived process would share the first one's id and
    their ledger rows would collide on ``(run_id, stage)``.

    Still exported, so subprocesses of *this* run inherit it as before.
    """
    generated = f"run-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    os.environ[_RUN_ID_ENV] = generated
    return generated


class ObsLog:
    """Append-only JSONL writer, safe under concurrent writers.

    Uses ``flock`` plus a single write call rather than relying on ``O_APPEND``
    atomicity, which only holds below ``PIPE_BUF`` --- and a log line carrying a
    handful of fields can exceed that. The failure mode without it is interleaved
    half-lines, which corrupts the file for every reader at once.
    """

    def __init__(
        self,
        component: str,
        *,
        log_dir: str | Path = "data/logs",
        stream: str = "events",
        tenant_id: str = "",
    ) -> None:
        self.component = component
        self.stream = stream
        self.tenant_id = tenant_id
        self._dir = Path(log_dir)

    @property
    def path(self) -> Path:
        return self._dir / f"{self.stream}.jsonl"

    def write(self, level: str, event: str, message: str, **fields: Any) -> dict:
        record = {
            "ts": datetime.now(UTC).isoformat(timespec="microseconds"),
            "level": level,
            "component": self.component,
            "run_id": run_id(),
            "tenant_id": self.tenant_id,
            "event": event,
            "message": message,
        }
        for key, value in fields.items():
            record[key] = "<redacted>" if key.lower() in _REDACTED else value

        self._dir.mkdir(parents=True, exist_ok=True)
        line = (json.dumps(record, sort_keys=True, default=str) + "\n").encode()
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            written = 0
            while written < len(line):
                written += os.write(fd, line[written:])
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)
        return record

    def start(self, message: str, **fields: Any) -> dict:
        return self.write("info", "start", message, **fields)

    def finish(self, message: str, **fields: Any) -> dict:
        return self.write("info", "finish", message, **fields)

    def error(self, message: str, **fields: Any) -> dict:
        return self.write("error", "error", message, **fields)

    def swallowed(self, message: str, **fields: Any) -> dict:
        """Record an exception that was caught and handled.

        Deliberately does not accept the exception text. A stringified exception
        routinely contains the row that caused it, which is how customer data
        reaches a log file. Log the reason code; the payload belongs in
        quarantine, where access is controlled.
        """
        return self.write("warning", "swallowed", message, **fields)


def log(component: str, **kwargs: Any) -> ObsLog:
    return ObsLog(component, **kwargs)
