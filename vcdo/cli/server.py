"""A minimal HTTP trigger so Kestra and the control plane can run pipeline verbs.

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
  network can reach it. The control plane calls it over that network as
  ``http://vcdo-worker:8081``; it is the API service, not this, that has a domain.
- One job at a time. A second request while a run is in flight gets 409 rather
  than starting an overlapping sync, because two concurrent runs against the
  same source produce interleaved cursor state that is very hard to unpick.

**Synchronous is the default, and that is load-bearing.** Every flow in
``flows/`` asserts ``outputs.run_slice.code != 200`` and logs the returned body.
If this endpoint replied 202-with-a-handle, those assertions would not merely
fail -- they would silently degrade from "the run succeeded" to "the run
started", and nightly failure detection would stop working while still looking
green. So a request without a body behaves exactly as it always has, and the
control plane opts in to a handle with ``{"async": true}`` because a browser
cannot hold a connection open for a multi-minute sync.
"""

from __future__ import annotations

import hmac
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from vcdo.core.config import load
from vcdo.core.obs_log import ObsLog, new_run_id

__all__ = ["serve"]

_LOCK = threading.Lock()

#: Runs started with ``{"async": true}``, by run id.
#:
#: Since ADR 0007 removed the run ledger this is the **only** record of an
#: asynchronous run, and it lives in memory: a worker restart loses it, and the
#: control plane then has nothing to show for a run that was in flight. That is
#: a known consequence of the removal, not an oversight.
#:
#: One entry per run on a server that runs one job at a time is not a leak worth
#: an eviction policy.
_RUNS: dict[str, dict] = {}


def _tenants(cfg) -> list[str]:
    """Which tenants a run with no named tenant should cover.

    Every active one, because the scheduled flows post no tenant and under
    multi-tenancy "the nightly sync" means all of them -- not whichever one a
    constant happened to name.

    An empty registry falls back to the fixture tenant rather than doing
    nothing. A deployment with no customers onboarded yet is exactly the state
    the fixture slice exists to exercise, and a silent no-op would report success
    for a run that did not happen.
    """
    from vcdo.cli.pipeline import FIXTURE_TENANT

    try:
        import psycopg

        with psycopg.connect(cfg.postgres_dsn, connect_timeout=10) as conn:
            rows = conn.execute("SELECT id FROM ops.tenant WHERE status = 'active' ORDER BY id").fetchall()
        return [r[0] for r in rows] or [FIXTURE_TENANT]
    except Exception:
        # Before migration 007 there is no registry. Not a failure: the fixture
        # slice predates tenancy and must keep running.
        return [FIXTURE_TENANT]


def _known_tenant(cfg, tenant_id: str) -> bool:
    import psycopg

    with psycopg.connect(cfg.postgres_dsn, connect_timeout=10) as conn:
        found = conn.execute("SELECT 1 FROM ops.tenant WHERE id = %s", (tenant_id,)).fetchone()
    return found is not None


def _verbs():
    from vcdo.cli import pipeline

    def _migrate(cfg, log, **_):
        return pipeline.migrate(cfg, log)

    def _seed(cfg, log, *, tenant_id, **_):
        return pipeline.seed(cfg, log, tenant_id=tenant_id)

    def _slice(cfg, log, *, tenant_id, **_):
        return pipeline.run_slice(cfg, log, tenant_id=tenant_id)

    def _backup(cfg, log, **_):
        from vcdo.cli.backup import dump

        result = dump(cfg.postgres_dsn, "/app/data/backups")
        log.finish("backup taken", path=str(result.path), bytes=result.bytes)
        return {"path": str(result.path), "bytes": result.bytes}

    return {
        "migrate": _migrate,
        "seed": _seed,
        "slice": _slice,
        "backup": _backup,
    }


#: Verbs that operate on one tenant at a time. The rest are platform-wide and
#: absorb the argument, so the dispatcher keeps one uniform call shape.
PER_TENANT = ("seed", "slice")


class _Handler(BaseHTTPRequestHandler):
    token: str = ""

    def verbs(self) -> dict:
        """The allowlist this handler will dispatch.

        A method rather than a direct call so a test can serve a real, trivial
        verb set over a real socket instead of standing up Postgres and MinIO to
        assert on a status code. Still an allowlist, still a fixed dict; the
        production path is :func:`_verbs` and nothing reads user input to build it.
        """
        return _verbs()

    def _reply(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_body(self) -> dict:
        """Consume exactly Content-Length bytes, always.

        This handler used to never read the body at all, so the flows' ``{}``
        was discarded and anything sent in it was silently ignored. Reading it
        is also what keeps the connection usable: an unread body sits in the
        socket and becomes the start of whatever is parsed next.

        A malformed body is an empty dict, not an error. The only thing it can
        carry is optional, and rejecting a request over it would break a caller
        that sent a trailing comma while changing nothing about what runs.
        """
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b""
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}

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

        if self.path.startswith("/run/"):
            if not self._authorised():
                self._reply(401, {"error": "unauthorised"})
                return
            run = _RUNS.get(self.path.removeprefix("/run/"))
            if run is None:
                self._reply(404, {"error": "unknown run"})
                return
            self._reply(200, run)
            return

        self._reply(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        # Read the body before any reply, on every path including the refusals.
        # Leaving it unread would desynchronise a keep-alive connection.
        body = self._read_body()

        if not self._authorised():
            self._reply(401, {"error": "unauthorised"})
            return

        verb = self.path.strip("/").removeprefix("run/")
        verbs = self.verbs()
        if verb not in verbs:
            self._reply(404, {"error": f"unknown verb {verb!r}", "known": sorted(verbs)})
            return

        cfg = load()

        requested = str(body.get("tenant") or "").strip()
        if requested:
            # Validated against the registry, so the only tenant ids that reach a
            # lake key or a SQL parameter are ones we put there.
            try:
                if not _known_tenant(cfg, requested):
                    self._reply(404, {"error": "unknown tenant"})
                    return
            except Exception as exc:
                self._reply(500, {"error_type": type(exc).__name__})
                return
            tenants = [requested]
        else:
            tenants = _tenants(cfg) if verb in PER_TENANT else [""]

        if not _LOCK.acquire(blocking=False):
            self._reply(409, {"error": "a run is already in progress"})
            return

        if body.get("async") is True:
            run_id = new_run_id()
            _RUNS[run_id] = {"run_id": run_id, "verb": verb, "status": "running", "tenants": tenants}
            thread = threading.Thread(
                target=self._run_and_release,
                args=(cfg, verb, verbs[verb], tenants, run_id),
                daemon=True,
            )
            thread.start()
            self._reply(202, {"run_id": run_id, "verb": verb, "status": "running"})
            return

        try:
            result = self._execute(cfg, verb, verbs[verb], tenants)
            self._reply(200, {"verb": verb, "result": _jsonable(result)})
        except Exception as exc:
            # The type, never the message: exception text routinely embeds the
            # offending row, and this response goes into Kestra's execution log.
            ObsLog(f"trigger.{verb}", log_dir=cfg.log_dir).error(
                f"{verb} failed", error_type=type(exc).__name__
            )
            self._reply(500, {"verb": verb, "error_type": type(exc).__name__})
        finally:
            _LOCK.release()

    def _execute(self, cfg, verb: str, fn, tenants: list[str]):
        """Run one verb over every tenant it applies to.

        A fresh run id per tenant. The run id is stamped into every lake
        manifest, curated row and quarantine record this run writes, so sharing
        one across tenants makes "which run produced this" unanswerable -- see
        :func:`vcdo.core.obs_log.new_run_id`.
        """
        results = {}
        for tenant_id in tenants:
            new_run_id()
            log = ObsLog(f"trigger.{verb}", log_dir=cfg.log_dir, tenant_id=tenant_id)
            results[tenant_id or verb] = fn(cfg, log, tenant_id=tenant_id)
        return results if len(results) != 1 else next(iter(results.values()))

    def _run_and_release(self, cfg, verb: str, fn, tenants: list[str], run_id: str) -> None:
        try:
            result = self._execute(cfg, verb, fn, tenants)
            _RUNS[run_id] |= {"status": "ok", "result": _jsonable(result)}
        except Exception as exc:
            ObsLog(f"trigger.{verb}", log_dir=cfg.log_dir).error(
                f"{verb} failed", error_type=type(exc).__name__
            )
            _RUNS[run_id] |= {"status": "error", "error_type": type(exc).__name__}
        finally:
            _LOCK.release()

    def log_message(self, fmt: str, *args) -> None:
        # Silence the default stderr access log; we emit structured JSONL instead.
        pass


def _jsonable(value):
    """Render a verb's result as real JSON, recursively.

    A ``Decimal`` becomes a **string**, never a float. ``won_amount`` is money,
    and ``json.dumps`` would happily turn it into a float here -- which is the
    one conversion `.claude/rules/data-integrity.md` forbids outright, and the
    control plane would then render a rounded figure it believed was exact.

    Recursion matters because a multi-tenant sweep returns a dict of dicts. A
    single ``str()`` at the top level turned the inner one into a Python repr,
    which no caller can parse.
    """
    from decimal import Decimal

    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_jsonable(v) for v in value]
    if isinstance(value, bool | int | float | str) or value is None:
        return value
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
