# 146. A dbt login's statement ends with its client

- Status: Accepted
- Date: 2026-10-18
- Builds on: [ADR 0088](0088-tenant-logins-reach-postgres-through-a-pooler-and-runs-take-a-turn.md)
  (the pooler and the timeout chain a tenant login runs under) and
  [ADR 0087](0087-a-tenant-login-is-leased-not-rotated-per-session.md) (the login's password is
  rotated by the worker, which is why a role's own row is written sparingly).

## Context

Issue 490. One customer's builds began to fail one after another, each saying only "dbt build
exited 143". A build that reaches its deadline has its dbt process sent SIGTERM (`realSpawn`,
`transform.ts`), which is the 143. That stops dbt. It does not stop the statement dbt had already
sent: the Postgres backend goes on with its `CREATE TABLE AS`, holding the locks it took, because
Postgres checks that a client is still there only when the backend next touches the socket, and
a backend busy computing does not. `client_connection_check_interval` is 0 by default, which
turns the check off.

The next build of that tenant loads the same seeds. Its `TRUNCATE` waits on the orphan's lock,
runs into its own deadline, is killed in turn, and leaves one more orphan. Nothing ends the
sequence until someone terminates the backends by hand.

The dbt login has no `statement_timeout` (`ops.provision_tenant` sets one only on the BI login,
15 s). dbt reaches Postgres through PgBouncer in session mode, which closes the server connection
when its client goes away while the server is not idle, so a backend that looks at its socket
sees the close.

## Decision

`ops.provision_tenant` sets `client_connection_check_interval = '5s'` on the tenant's dbt login,
beside the BI login's settings. A backend running a statement for that login then checks its
client every 5 s and, when the connection is gone, aborts the statement and releases its locks.

It is stated in `repeatable/010_provision_tenant.sql`, unconditionally, so the next deploy
re-provisions every tenant created before it. `ALTER ROLE ... SET` writes `pg_db_role_setting`,
not the role's own `pg_authid` row, so it does not race the password rotation that the
`CONNECTION LIMIT` guard in the same function exists to avoid (ADR 0087).

The build's own report says what happened. `SpawnResult` carries `timedOut`, true only when
`realSpawn`'s deadline stopped the child, and `runTransform` raises "dbt build ran past its N-second deadline
and was stopped" in that case, whatever steps the killed build left, instead of "exited 143".

## Options rejected

- **A `statement_timeout` on the dbt login.** A scheduled build legitimately runs for up to thirty
  minutes and an editor build for two, and a role-wide number cannot be both. Either it kills an
  honest scheduled model, or it leaves the editor's orphan alive for thirty minutes.
- **The worker terminates the build's backends after a deadline.** It needs `pg_signal_backend`
  on the tenant's login or another `SECURITY DEFINER` hook. It cannot tell one run's backends from
  another's, since dbt sets no per-run `application_name`, so it could end a concurrent query of
  the same login. And it does nothing when the worker itself is what died mid-build, which leaves
  the same orphan.
- **`tcp_user_timeout` / TCP keepalives on the server.** They govern a peer that vanished without
  closing. Here the peer closed, and PgBouncer closed the server side; the backend simply never
  looks. The connection check is the setting that makes it look.
- **Killing dbt's whole process group.** The process is already gone. The statement is not part of
  it.

## Consequences

- An orphaned statement of a dbt login now ends within about 5 s of its client leaving, whoever
  the client was and however it ended, a deadline, a restart or a crash.
- A running statement costs one extra socket poll every 5 s per backend. Not measurable beside
  a statement that long.
- A build the deadline stopped has its own error text, so the run ledger says "past its deadline"
  where it said "exited 143".
- A pooler that does not close the server connection when its client leaves would defeat the
  setting, since the backend would see an open socket. PgBouncer in session mode does, which is
  why the isolation test drives a killed client through the pooler.
- The BI login is untouched: its 15 s `statement_timeout` already bounds it.
