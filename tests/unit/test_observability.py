"""Logs must be queryable, must not leak data, and must account for every row.

The failure these guard against is the quiet one: a stage that drops rows without
anyone deciding to, showing up months later as a month that looked a bit small.
"""

import json

import pytest

from vcdo.core.obs_log import REQUIRED_FIELDS, ObsLog, run_id
from vcdo.core.run_ledger import STREAM, stage


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


# -- run ledger ---------------------------------------------------------------


def test_a_balanced_stage_reports_nothing_unaccounted(tmp_path):
    log = ObsLog("transform", log_dir=tmp_path)
    with stage("normalize", log) as st:
        st.rows_in(100)
        st.rows_out(90)
        st.excluded(10, "voided_invoice")

    assert st.unaccounted == 0
    assert st.row["excluded_by_reason"] == {"voided_invoice": 10}


def test_rows_that_vanish_without_a_decision_are_surfaced(tmp_path):
    """This is the signature of a silent shortfall, and it must never be quiet."""
    log = ObsLog("transform", log_dir=tmp_path)
    with stage("normalize", log) as st:
        st.rows_in(100)
        st.rows_out(90)

    assert st.unaccounted == 10
    ledger = read(tmp_path / f"{STREAM}.jsonl")[-1]
    assert ledger["unaccounted"] == 10
    assert ledger["level"] == "warning"


def test_exclusions_are_broken_out_by_reason(tmp_path):
    """One routine reason and one alarming one must not aggregate into a number."""
    log = ObsLog("transform", log_dir=tmp_path)
    with stage("normalize", log) as st:
        st.rows_in(412)
        st.excluded(400, "voided_invoice")
        st.excluded(12, "schema_invalid")

    assert st.row["excluded_by_reason"] == {"voided_invoice": 400, "schema_invalid": 12}
    assert st.row["rows_excluded"] == 412


def test_an_exclusion_without_a_reason_is_refused():
    """An unexplained exclusion is indistinguishable from a bug."""
    log = ObsLog("transform", log_dir="/tmp/unused")
    unstarted = stage("normalize", log)
    with pytest.raises(ValueError, match="reason"):
        unstarted.excluded(5, "")


def test_a_crashing_stage_still_writes_its_row(tmp_path):
    """The counts matter most on the failure path, which is where a manual write is skipped."""
    log = ObsLog("transform", log_dir=tmp_path)

    with pytest.raises(RuntimeError), stage("normalize", log) as st:
        st.rows_in(50)
        raise RuntimeError("customer ACME Pte Ltd has a malformed row")

    ledger = read(tmp_path / f"{STREAM}.jsonl")[-1]
    assert ledger["status"] == "error"
    assert ledger["rows_in"] == 50


def test_a_crash_does_not_leak_the_exception_message(tmp_path):
    """Exception text routinely embeds the offending row."""
    log = ObsLog("transform", log_dir=tmp_path)

    with pytest.raises(RuntimeError), stage("normalize", log) as st:
        st.rows_in(1)
        raise RuntimeError("customer ACME Pte Ltd has a malformed row")

    written = (tmp_path / f"{STREAM}.jsonl").read_text()
    assert "ACME" not in written
    assert json.loads(written.splitlines()[-1])["error_type"] == "RuntimeError"


def test_stage_failures_are_not_swallowed(tmp_path):
    """A ledger that ate the exception would turn a crash into a silent success."""
    log = ObsLog("transform", log_dir=tmp_path)
    with pytest.raises(RuntimeError), stage("normalize", log):
        raise RuntimeError("boom")
