---
title: ADR 0146 A dbt Login's Statement Ends With Its Client
type: source
date: 2026-10-18
tags: []
source: docs/adr/0146-a-dbt-login-s-statement-ends-with-its-client.md
source_path: docs/adr/0146-a-dbt-login-s-statement-ends-with-its-client.md
source_hash: ee7a4e6347de5ec86e0003daafb68d18ddcc7b85abfa3e0c07ad26bba896e108
ingested: 2026-10-18
---

# ADR 0146 A dbt Login's Statement Ends With Its Client

# ADR 0146 A dbt Login's Statement Ends With Its Client

Builds on [[ADR 0088 Tenant Logins Reach Postgres Through A Pooler And Runs Take A Turn]] (the pooler and the timeout chain) and [[ADR 0087 A Tenant Login Is Leased Not Rotated Per Session]] (why a role's own row is written sparingly).

**Why.** Issue 490. A build that reaches its deadline has its dbt process sent SIGTERM (`realSpawn`, exit 143), which stops dbt but not the statement it sent: Postgres checks a client only when the backend next touches its socket, and `client_connection_check_interval` is 0 by default. The orphaned `CREATE TABLE AS` kept its locks, the next build's seed `TRUNCATE` waited on them and died at its own deadline, and left another orphan; the run said only "dbt build exited 143".

**What.** `ops.provision_tenant` (`repeatable/010_provision_tenant.sql`) sets `client_connection_check_interval = '5s'` on each tenant's dbt login, unconditionally, so every existing tenant gets it at the next deploy. `ALTER ROLE ... SET` writes `pg_db_role_setting`, not the role's `pg_authid` row, so it does not race the password rotation. PgBouncer in session mode closes the server connection when its client leaves mid-statement, so the backend sees the close within 5 s, aborts and releases its locks -- whether the client ended by a deadline, a restart or a crash. `SpawnResult.timedOut` is true only when `realSpawn`'s own deadline stopped the child, and `runTransform` then raises "dbt build ran past its N-second deadline and was stopped" instead of "exited 143".

**Rejected.** A `statement_timeout` on the dbt login (a scheduled build runs up to 30 minutes, an editor build 2; one number cannot be both); the worker terminating backends after a deadline (needs `pg_signal_backend` or a new SECURITY DEFINER hook, cannot tell one run's backends from another's, and does nothing when the worker itself died); TCP keepalives or `tcp_user_timeout` (they cover a peer that vanished without closing); killing dbt's process group (the statement is not part of it).

**Consequences.** One socket poll every 5 s per running backend. The BI login is untouched; its 15 s `statement_timeout` already bounds it. A pooler that did not close the server side would defeat the setting, which is why the isolation integration test drives a killed client through PgBouncer.
