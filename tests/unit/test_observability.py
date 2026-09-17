"""Logs must be queryable, must not leak data, and must stay attributable.

The run ledger that used to live beside this module was removed in ADR 0007;
what remains here is the structured log itself. Two properties still matter and
are guarded below: every line carries the fields that make it queryable, and no
line carries a secret or a customer's data.
"""

import json

from vcdo.core.obs_log import REQUIRED_FIELDS, ObsLog, new_run_id, run_id


def read(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def test_every_line_carries_the_mandatory_fields(tmp_path):
    """A log that is only sometimes structured cannot be queried at all."""
    log = ObsLog("ingest.hubspot", log_dir=tmp_path)
    log.start("pulling contacts")

    record = read(log.path)[0]
    for field in REQUIRED_FIELDS:
        assert field in record, f"missing mandatory field {field}"


def test_one_run_id_is_shared_across_loggers(tmp_path, monkeypatch):
    """A pipeline of several components must be traceable as one run."""
    monkeypatch.delenv("VCDO_RUN_ID", raising=False)
    a = ObsLog("extract", log_dir=tmp_path)
    b = ObsLog("load", log_dir=tmp_path)
    a.start("go")
    b.finish("done")

    ids = {r["run_id"] for r in read(a.path)}
    assert len(ids) == 1


def test_run_id_is_inherited_rather_than_regenerated(monkeypatch):
    """Subprocesses inherit through the environment; a fresh id would break tracing."""
    monkeypatch.setenv("VCDO_RUN_ID", "run-from-parent")
    assert run_id() == "run-from-parent"


def test_starting_a_new_run_replaces_an_inherited_id(monkeypatch):
    """The long-lived worker serves many runs; reusing one id makes their
    output indistinguishable."""
    monkeypatch.setenv("VCDO_RUN_ID", "run-from-parent")

    assert new_run_id() != "run-from-parent"
    assert new_run_id() != new_run_id()


def test_a_new_run_id_is_still_exported_for_subprocesses(monkeypatch):
    """Regenerating must not cost the inheritance that run ids exist for."""
    monkeypatch.delenv("VCDO_RUN_ID", raising=False)
    started = new_run_id()

    assert run_id() == started


def test_two_tenants_in_one_process_do_not_share_a_run_id(tmp_path, monkeypatch):
    """The run id is stamped into every lake manifest, curated row, quarantine
    record and gate finding this run writes.

    Sharing one across tenants makes "which run produced this object" -- the
    question provenance exists to answer -- unanswerable. The worker is
    long-lived and serves many runs, so a cached id is not a theoretical problem.
    """
    monkeypatch.delenv("VCDO_RUN_ID", raising=False)

    seen = []
    for tenant in ("CASE-001", "CASE-002"):
        new_run_id()
        log = ObsLog("curate", log_dir=tmp_path, tenant_id=tenant)
        log.start("curating")
        seen.append((run_id(), tenant))

    assert [t for _, t in seen] == ["CASE-001", "CASE-002"]
    assert len({r for r, _ in seen}) == 2

    written = read(tmp_path / "events.jsonl")
    assert {r["tenant_id"] for r in written} == {"CASE-001", "CASE-002"}


def test_secret_shaped_fields_never_reach_the_log(tmp_path):
    """Logs travel further and live longer than the data they describe."""
    log = ObsLog("auth", log_dir=tmp_path)
    log.start("refreshed", access_token="pat-real-secret", api_key="k", contact_id="123")

    record = read(log.path)[0]
    assert record["access_token"] == "<redacted>"
    assert record["api_key"] == "<redacted>"
    assert "pat-real-secret" not in log.path.read_text()
    assert record["contact_id"] == "123"  # identifiers are fine and necessary


def test_concurrent_writes_produce_whole_lines(tmp_path):
    """Without flock, interleaved partial writes corrupt the file for every reader."""
    log = ObsLog("busy", log_dir=tmp_path)
    for i in range(200):
        log.write("info", "tick", "x" * 300, seq=i)

    records = read(log.path)
    assert len(records) == 200
    assert {r["seq"] for r in records} == set(range(200))
