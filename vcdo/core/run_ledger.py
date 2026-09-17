"""One row per pipeline stage: what went in, what came out, and what did not.

The field that matters most is ``unaccounted``::

    unaccounted = rows_in - rows_out - rows_excluded

If it is non-zero, rows vanished without anyone deciding they should. That is the
signature of the worst class of data bug --- not a crash, but a quiet shortfall
that looks like a smaller month. Every stage computes it, and a non-zero value is
surfaced rather than logged and forgotten.

Exclusions are counted *by reason*. "We dropped 412 rows" is not actionable;
"we dropped 412 rows because 400 were VOIDED and 12 failed schema validation" is
one fine and one alarming. Aggregating them into a single number hides the
alarming one behind the routine one.

This is not a new store. It is a named stream inside :mod:`vcdo.core.obs_log`, so
it inherits that module's atomicity, run-id propagation and PII discipline
instead of re-implementing all three slightly differently.
"""

from __future__ import annotations

import time
from collections import Counter
from dataclasses import dataclass, field
from types import TracebackType

from vcdo.core.obs_log import ObsLog

__all__ = ["Stage", "stage"]

STREAM = "run-ledger"


@dataclass
class Stage:
    """A unit of pipeline work being measured.

    Used as a context manager so the row is always written --- including on the
    exception path, which is precisely when the counts matter and precisely when
    a manually-placed write gets skipped.
    """

    name: str
    log: ObsLog
    _rows_in: int = 0
    _rows_out: int = 0
    _excluded: Counter = field(default_factory=Counter)
    _started: float = 0.0
    status: str = "ok"
    row: dict = field(default_factory=dict)

    def rows_in(self, n: int) -> None:
        self._rows_in += n

    def rows_out(self, n: int) -> None:
        self._rows_out += n

    def excluded(self, n: int, reason: str) -> None:
        """Record rows deliberately dropped, with a reason code.

        The reason is required. An exclusion without one is indistinguishable
        from a bug, and six months later nobody can tell which it was.
        """
        if not reason:
            raise ValueError("an exclusion must carry a reason code")
        self._excluded[reason] += n

    @property
    def unaccounted(self) -> int:
        return self._rows_in - self._rows_out - sum(self._excluded.values())

    def __enter__(self) -> Stage:
        self._started = time.monotonic()
        self.log.start(f"stage {self.name} started", stage=self.name)
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool:
        if exc_type is not None:
            self.status = "error"

        self.row = {
            "stage": self.name,
            "status": self.status,
            "duration_ms": int((time.monotonic() - self._started) * 1000),
            "rows_in": self._rows_in,
            "rows_out": self._rows_out,
            "rows_excluded": sum(self._excluded.values()),
            "excluded_by_reason": dict(self._excluded),
            "unaccounted": self.unaccounted,
            # The exception *type* is safe to record; its message is not, because
            # it routinely embeds the offending row.
            "error_type": exc_type.__name__ if exc_type else None,
        }

        level = "error" if self.status == "error" else ("warning" if self.unaccounted else "info")
        ObsLog(self.log.component, log_dir=self.log._dir, stream=STREAM).write(
            level, "stage", f"stage {self.name} {self.status}", **self.row
        )
        return False  # never swallow


def stage(name: str, log: ObsLog) -> Stage:
    return Stage(name, log)
