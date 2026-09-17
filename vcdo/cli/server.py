"""A minimal HTTP trigger so Kestra can run pipeline verbs.

**Why not the Docker socket.** The usual way to let Kestra run a job in another
image is to mount ``/var/run/docker.sock`` into Kestra. That grants Kestra
full control of the Docker daemon, which on a shared host means a Kestra
compromise is a host compromise -- and this host runs eleven other projects. A
narrow HTTP endpoint that can start a handful of named verbs is a far smaller
blast radius than "can start any container as root".

Deliberately tiny, and deliberately not a web framework:

- A fixed allowlist of verbs. No arbitrary command execution, no shell, no user
  input reaching a subprocess. The verb is looked up in a dict; anything else is
  a 404 that names what is permitted.
- Bearer token required, compared with :func:`hmac.compare_digest` so a wrong
  token cannot be recovered by timing the response.
- Bound to the container's own interface and never published. Only the compose
  network can reach it.
- One job at a time. A second request while a run is in flight gets 409 rather
  than starting an overlapping sync, because two concurrent runs against the
  same source produce interleaved cursor state that is very hard to unpick.
"""

from __future__ import annotations

import hmac
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from vcdo.core.config import load
from vcdo.core.obs_log import ObsLog

__all__ = ["serve"]

_LOCK = threading.Lock()


def _verbs():
    from vcdo.cli import pipeline

    def _backup(cfg, log):
        from vcdo.cli.backup import dump

        result = dump(cfg.postgres_dsn, "/app/data/backups")
        log.finish("backup taken", path=str(result.path), bytes=result.bytes)
        return {"path": str(result.path), "bytes": result.bytes}

    def _alerts(cfg, log):
        import psycopg

        from vcdo.core.alerts import evaluate

        with psycopg.connect(cfg.postgres_dsn, connect_timeout=10) as conn:
            rows = [
                dict(
                    zip(
                        (
                            "stage",
                            "status",
                            "rows_in",
                            "rows_out",
                            "rows_excluded",
                            "unaccounted",
                            "error_type",
                            "recorded_at",
                        ),
                        r,
                        strict=True,
                    )
                )
                for r in conn.execute(
                    "SELECT stage, status, rows_in, rows_out, rows_excluded, unaccounted, "
                    "error_type, recorded_at FROM ops.run_ledger ORDER BY recorded_at"
                )
            ]
        found = evaluate(rows)
        criticals = [a for a in found if a.severity == "critical"]
        if criticals:
            # Raised, not returned: the trigger turns an exception into a 500,
            # and Kestra turns a 500 into a failed execution that alerts.
            raise RuntimeError(f"{len(criticals)} critical alert(s): {criticals[0].code}")
        return {"alerts": len(found), "critical": 0}

    return {
        "migrate": pipeline.migrate,
        "seed": pipeline.seed,
        "slice": pipeline.run_slice,
        "backup": _backup,
        "alerts": _alerts,
    }


class _Handler(BaseHTTPRequestHandler):
    token: str = ""

    def _reply(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _authorised(self) -> bool:
        supplied = self.headers.get("Authorization", "")
        expected = f"Bearer {self.token}"
        return bool(self.token) and hmac.compare_digest(supplied, expected)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's interface
        if self.path == "/health":
            # Unauthenticated on purpose: it reveals nothing and a healthcheck
            # that needs a secret is a healthcheck that silently stops working
            # when the secret rotates.
            self._reply(200, {"status": "ok"})
            return
        self._reply(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self._authorised():
            self._reply(401, {"error": "unauthorised"})
            return

        verb = self.path.strip("/").removeprefix("run/")
        verbs = _verbs()
        if verb not in verbs:
            self._reply(404, {"error": f"unknown verb {verb!r}", "known": sorted(verbs)})
            return

        if not _LOCK.acquire(blocking=False):
            self._reply(409, {"error": "a run is already in progress"})
            return

        log = ObsLog(f"trigger.{verb}", log_dir=load().log_dir)
        try:
            result = verbs[verb](load(), log)
            self._reply(200, {"verb": verb, "result": _jsonable(result)})
        except Exception as exc:
            # The type, never the message: exception text routinely embeds the
            # offending row, and this response goes into Kestra's execution log.
            log.error(f"{verb} failed", error_type=type(exc).__name__)
            self._reply(500, {"verb": verb, "error_type": type(exc).__name__})
        finally:
            _LOCK.release()

    def log_message(self, fmt: str, *args) -> None:
        # Silence the default stderr access log; we emit structured JSONL instead.
        pass


def _jsonable(value):
    if isinstance(value, dict):
        return {k: str(v) for k, v in value.items()}
    return str(value)


def serve(port: int = 8081) -> None:
    token = os.environ.get("VCDO_TRIGGER_TOKEN", "").strip()
    if not token:
        raise SystemExit(
            "VCDO_TRIGGER_TOKEN is required. Refusing to start an unauthenticated "
            "endpoint that can launch pipeline runs."
        )
    _Handler.token = token
    HTTPServer(("0.0.0.0", port), _Handler).serve_forever()  # noqa: S104 - container-internal only
