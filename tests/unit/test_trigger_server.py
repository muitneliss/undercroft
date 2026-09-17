"""The worker's HTTP trigger, over a real socket.

THE REGRESSION THIS EXISTS FOR: all four flows in `flows/` contain

    condition: "{{ outputs.run_slice.code != 200 }}"

and log `outputs.run_slice.body` as the result. Making the endpoint asynchronous
would not simply fail those assertions -- it would quietly demote them from "the
run succeeded" to "the run started", and nightly failure detection would stop
working while every execution still went green. So a request with no body must
keep returning 200 and the full result, forever, and asynchrony is opt-in.

A real server on a real ephemeral port, driven over real HTTP. The verb set is a
real trivial implementation supplied by a subclass, not a patched one: these
assert on status codes and bodies, never on whether something was called.
"""

import json
import threading
import urllib.error
import urllib.request
from http.server import HTTPServer

import pytest

from vcdo.cli import server as trigger

TOKEN = "test-trigger-token"


class _RecordingVerbs(trigger._Handler):
    """A handler whose allowlist runs in-process instead of touching a stack."""

    def verbs(self):
        def _ok(cfg, log, *, tenant_id="", **_):
            return {"ran": "ok", "tenant": tenant_id}

        def _boom(cfg, log, **_):
            raise RuntimeError("customer ACME Pte Ltd has a malformed row")

        return {"slice": _ok, "backup": _ok, "explode": _boom}


@pytest.fixture
def base_url(monkeypatch, tmp_path):
    monkeypatch.setenv("VCDO_LOG_DIR", str(tmp_path))
    # No stack: _tenants() falls back to the fixture tenant, which is the
    # behaviour a deployment with nothing onboarded relies on.
    monkeypatch.setenv("VCDO_POSTGRES_DSN", "postgresql://nobody@127.0.0.1:1/none")
    _RecordingVerbs.token = TOKEN

    httpd = HTTPServer(("127.0.0.1", 0), _RecordingVerbs)
    # serve_forever's default 0.5s poll interval is what shutdown() waits on, so
    # the default would add half a second of teardown to every test in this file.
    thread = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_port}"
    finally:
        httpd.shutdown()
        httpd.server_close()


def post(base_url: str, path: str, body=None, token: str | None = TOKEN) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else b""
    request = urllib.request.Request(base_url + path, data=data, method="POST")
    request.add_header("Content-Type", "application/json")
    request.add_header("Content-Length", str(len(data)))
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def get(base_url: str, path: str, token: str | None = TOKEN) -> tuple[int, dict]:
    request = urllib.request.Request(base_url + path, method="GET")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


# -- the Kestra contract -----------------------------------------------------


def test_the_scheduled_shape_of_request_is_unchanged(base_url):
    """`body: "{}"` with no other keys, exactly as flows/*.yml sends it."""
    status, payload = post(base_url, "/run/slice", {})

    assert status == 200
    assert payload["verb"] == "slice"
    assert "result" in payload


def test_a_completely_bodyless_post_is_also_synchronous(base_url):
    status, payload = post(base_url, "/run/slice", None)

    assert status == 200
    assert "result" in payload


def test_a_failing_verb_is_a_500_so_kestra_fails_the_execution(base_url):
    status, payload = post(base_url, "/run/explode", {})

    assert status == 500
    assert payload["error_type"] == "RuntimeError"


def test_a_failure_response_does_not_leak_the_exception_message(base_url):
    """Exception text routinely embeds the offending row, and this body lands in
    Kestra's execution log."""
    _, payload = post(base_url, "/run/explode", {})

    assert "ACME" not in json.dumps(payload)


# -- asynchrony is opt-in -----------------------------------------------------


def test_asking_for_async_returns_a_handle_instead_of_the_result(base_url):
    status, payload = post(base_url, "/run/slice", {"async": True})

    assert status == 202
    assert payload["status"] == "running"
    assert payload["run_id"]


def test_the_handle_can_be_polled_to_completion(base_url):
    _, started = post(base_url, "/run/slice", {"async": True})

    status, payload = 0, {}
    for _ in range(200):
        status, payload = get(base_url, f"/run/{started['run_id']}")
        if payload.get("status") != "running":
            break

    assert status == 200
    assert payload["status"] == "ok"


def test_polling_an_unknown_run_is_a_404(base_url):
    status, _ = get(base_url, "/run/run-does-not-exist")

    assert status == 404


# -- the allowlist and the token ----------------------------------------------


def test_an_unknown_verb_is_refused_and_names_what_is_permitted(base_url):
    status, payload = post(base_url, "/run/rm-rf", {})

    assert status == 404
    assert payload["known"] == ["backup", "explode", "slice"]


def test_a_wrong_token_is_refused(base_url):
    status, _ = post(base_url, "/run/slice", {}, token="not-the-token")

    assert status == 401


def test_the_right_token_is_not_refused(base_url):
    status, _ = post(base_url, "/run/slice", {})

    assert status == 200


def test_a_refused_request_still_consumes_its_body(base_url):
    """An unread body stays in the socket and becomes the start of the next
    request parsed on that connection."""
    status, _ = post(base_url, "/run/slice", {"async": False, "padding": "x" * 5000}, token="wrong")
    assert status == 401

    # The connection is reusable because the body was drained.
    status, _ = post(base_url, "/run/slice", {})
    assert status == 200


def test_health_needs_no_token(base_url):
    status, payload = get(base_url, "/health", token=None)

    assert status == 200
    assert payload["status"] == "ok"


# -- tenant handling -----------------------------------------------------------


def test_an_unnamed_tenant_falls_back_rather_than_running_nothing(base_url):
    """With no registry reachable, the fixture tenant runs. A silent no-op would
    report success for a run that did not happen."""
    _, payload = post(base_url, "/run/slice", {})

    assert "portal-fixture" in json.dumps(payload["result"])


def test_a_malformed_body_does_not_change_what_runs(base_url):
    """The only thing the body carries is optional; rejecting over a trailing
    comma would break a caller while changing nothing about the run."""
    request = urllib.request.Request(base_url + "/run/slice", data=b"{not json", method="POST")
    request.add_header("Authorization", f"Bearer {TOKEN}")
    request.add_header("Content-Length", "9")
    with urllib.request.urlopen(request, timeout=10) as response:
        assert response.status == 200


# -- result serialisation ------------------------------------------------------


def test_money_in_a_result_is_a_string_never_a_float():
    """`won_amount` is a Decimal. json.dumps would make it a float, and the
    control plane would render a rounded figure believing it exact."""
    from decimal import Decimal

    rendered = trigger._jsonable({"won_amount": Decimal("8500.0000"), "won": 2})

    assert rendered["won_amount"] == "8500.0000"
    assert rendered["won"] == 2


def test_a_multi_tenant_sweep_serialises_as_nested_json_not_a_repr():
    """One str() at the top level turned the inner dict into a Python repr, which
    no caller can parse."""
    from decimal import Decimal

    rendered = trigger._jsonable({"CASE-001": {"landed": 44, "won_amount": Decimal("1.50")}})

    assert rendered["CASE-001"]["landed"] == 44
    assert rendered["CASE-001"]["won_amount"] == "1.50"
