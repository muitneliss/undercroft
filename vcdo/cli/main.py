"""Command-line entrypoint.

Verbs return an exit code, and the codes are semantic: ``0`` pass, ``1`` a real
failure, ``2`` a usage error. Distinguishing "your request is wrong" from "the
thing you asked about is broken" matters to anything scripting this, and
collapsing both into ``1`` makes automated callers guess.
"""

from __future__ import annotations

import argparse
import sys

from vcdo.core.config import MissingConfig, load

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_USAGE = 2


def doctor(_args: argparse.Namespace) -> int:
    """Check that every service the platform depends on is actually usable.

    Deliberately exercises the same seams the pipeline uses --- an S3 round trip,
    a real SQL query --- rather than pinging a health endpoint. A container can be
    "healthy" and still reject the credentials we hold, and that gap is exactly
    where a green dashboard hides a broken pipeline.
    """
    try:
        cfg = load()
    except MissingConfig as exc:
        print(f"config: FAIL  {exc}", file=sys.stderr)
        return EXIT_FAILED

    failures = 0

    print(f"mode:     {cfg.source_mode}  (live sources: {', '.join(cfg.live_sources) or 'none'})")

    # -- object store: write, read back, delete --------------------------------
    try:
        from vcdo.lake.s3 import from_config

        store = from_config(cfg)
        probe_key = "_doctor/probe"
        store.put(probe_key, b"vcdo-doctor")
        assert store.get(probe_key) == b"vcdo-doctor"
        store.delete(probe_key)
        print(f"s3:       OK    {cfg.s3_endpoint} bucket={cfg.s3_bucket_raw} (round trip)")
    except Exception as exc:
        print(f"s3:       FAIL  {cfg.s3_endpoint}: {type(exc).__name__}: {exc}", file=sys.stderr)
        failures += 1

    # -- curated store: a real query -------------------------------------------
    try:
        import psycopg

        with psycopg.connect(cfg.postgres_dsn, connect_timeout=5) as conn:
            version = conn.execute("select version()").fetchone()
            assert version is not None
        print(f"postgres: OK    {version[0].split(' on ')[0]}")
    except Exception as exc:
        print(f"postgres: FAIL  {type(exc).__name__}: {exc}", file=sys.stderr)
        failures += 1

    return EXIT_FAILED if failures else EXIT_OK


def _run_pipeline(verb: str):
    """Build the pipeline verbs. Config and logging are constructed once, here."""

    def run(_args: argparse.Namespace) -> int:
        from vcdo.cli import pipeline
        from vcdo.core.obs_log import ObsLog

        try:
            cfg = load()
        except MissingConfig as exc:
            print(f"config: FAIL  {exc}", file=sys.stderr)
            return EXIT_FAILED

        log = ObsLog(f"cli.{verb}", log_dir=cfg.log_dir)
        try:
            if verb == "migrate":
                applied = pipeline.migrate(cfg, log)
                print(f"migrate:  OK    {applied} migration(s) applied")
            elif verb == "seed":
                landed = pipeline.seed(cfg, log)
                for entity, n in landed.items():
                    print(f"seed:     OK    {entity}: {n}")
            else:
                r = pipeline.run_slice(cfg, log)
                print(f"landed:      {r['landed']} raw records")
                print(f"customers:   {r['customers']}")
                print(f"deals:       {r['deals']}")
                print(f"invoices:    {r['invoices']}")
                print(f"payments:    {r['payments']}")
                print(f"quarantined: {r['quarantined']}")
                print(f"linked:      {r['linked']} ({r['needs_review']} need review)")
                print(
                    f"dashboard:   {r['won_deals']} won deal(s), "
                    f"{r['won_amount']} across {r['currencies']} currency/currencies"
                )
        except Exception as exc:
            log.error(f"{verb} failed", error_type=type(exc).__name__)
            print(f"{verb}: FAIL  {type(exc).__name__}: {exc}", file=sys.stderr)
            return EXIT_FAILED
        return EXIT_OK

    return run


def alerts_cmd(_args: argparse.Namespace) -> int:
    """Exit 1 on a critical, 0 otherwise. Warnings print but do not fail.

    Semantic exit codes matter here: whatever schedules this needs to
    distinguish "something is broken" from "something is worth a look", and
    collapsing both into failure makes the second one get ignored.
    """
    import psycopg

    from vcdo.core.alerts import evaluate

    try:
        cfg = load()
    except MissingConfig as exc:
        print(f"alerts: FAIL  {exc}", file=sys.stderr)
        return EXIT_FAILED

    with psycopg.connect(cfg.postgres_dsn, connect_timeout=10) as conn:
        rows = [
            {
                "stage": r[0],
                "status": r[1],
                "rows_in": r[2],
                "rows_out": r[3],
                "rows_excluded": r[4],
                "unaccounted": r[5],
                "error_type": r[6],
                "recorded_at": r[7],
            }
            for r in conn.execute(
                """
                SELECT stage, status, rows_in, rows_out, rows_excluded,
                       unaccounted, error_type, recorded_at
                FROM ops.run_ledger
                ORDER BY recorded_at
                """
            )
        ]

    found = evaluate(rows)
    if not found:
        print(f"alerts:   OK    {len(rows)} ledger rows, nothing to report")
        return EXIT_OK

    for alert in found:
        stream = sys.stderr if alert.severity == "critical" else sys.stdout
        print(f"          {alert}", file=stream)

    criticals = [a for a in found if a.severity == "critical"]
    print(f"alerts:   {len(criticals)} critical, {len(found) - len(criticals)} warning")
    return EXIT_FAILED if criticals else EXIT_OK


def backup_cmd(args: argparse.Namespace) -> int:
    from vcdo.cli.backup import dump

    try:
        cfg = load()
        result = dump(cfg.postgres_dsn, args.out_dir)
    except MissingConfig as exc:
        print(f"backup: FAIL  {exc}", file=sys.stderr)
        return EXIT_FAILED
    except Exception as exc:
        print(f"backup: FAIL  {type(exc).__name__}: {exc}", file=sys.stderr)
        return EXIT_FAILED

    print(f"backup:   OK    {result.path} ({result.bytes} bytes, schemas: {', '.join(result.schemas)})")
    return EXIT_OK


def serve_cmd(_args: argparse.Namespace) -> int:
    from vcdo.cli.server import serve

    print("trigger listening on :8081 (container-internal)")
    serve()
    return EXIT_OK


def provision_bi(_args: argparse.Namespace) -> int:
    from vcdo.cli.metabase import MetabaseError, provision_from_env

    try:
        result = provision_from_env()
    except KeyError as exc:
        print(f"provision-bi: FAIL  {exc} is not set", file=sys.stderr)
        return EXIT_FAILED
    except MetabaseError as exc:
        print(f"provision-bi: FAIL  {exc}", file=sys.stderr)
        return EXIT_FAILED

    made = [k for k, v in result["created"].items() if v] or ["nothing (already provisioned)"]
    print(f"metabase: OK    database id={result['database_id']}, created: {', '.join(made)}")
    for name in result["tables"]:
        print(f"          visible: {name}")
    return EXIT_OK


def not_implemented(name: str):
    def run(_args: argparse.Namespace) -> int:
        print(f"`{name}` is not implemented yet", file=sys.stderr)
        return EXIT_FAILED

    return run


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="vcdo", description="VietCham data platform")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("doctor", help="check that the stack is usable").set_defaults(fn=doctor)
    sub.add_parser("alerts", help="evaluate run health; exit 1 on any critical").set_defaults(fn=alerts_cmd)

    backup_parser = sub.add_parser("backup", help="dump curated schemas")
    backup_parser.add_argument("--out-dir", default="/app/data/backups")
    backup_parser.set_defaults(fn=backup_cmd)

    sub.add_parser("serve", help="run the HTTP trigger for Kestra").set_defaults(fn=serve_cmd)
    sub.add_parser("provision-bi", help="provision Metabase (idempotent)").set_defaults(fn=provision_bi)
    sub.add_parser("migrate", help="apply curated schema migrations").set_defaults(
        fn=_run_pipeline("migrate")
    )
    sub.add_parser("seed", help="land source records into the lake").set_defaults(fn=_run_pipeline("seed"))
    sub.add_parser("slice", help="raw -> curated -> dashboard query").set_defaults(fn=_run_pipeline("slice"))
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "fn", None):
        parser.print_help()
        return EXIT_USAGE
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
