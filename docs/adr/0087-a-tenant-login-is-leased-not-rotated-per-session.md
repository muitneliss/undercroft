# 87. A tenant's login is leased by the sessions that overlap it, not rotated for each one

- Status: Accepted
- Date: 2026-09-29
- Supersedes: [ADR 0018](0018-per-tenant-roles-and-row-level-security.md) on one point only --
  "the worker holds the value for one dbt build or one pooled query session" -- and closes the
  worker-side fix [ADR 0038](0038-the-console-buffer-is-a-script.md) deferred.

## Context

Every build and every query session as a tenant began with `ops.rotate_tenant_password`: a
fresh password for the tenant's dbt or BI login, held for that one use. A Postgres role has
exactly one password, so each rotation refused every other use of the same login that had not
yet authenticated.

ADR 0038 met this as a console that fired two queries at once and serialised them in the
browser. It met a build in production. `dbt build` gets its password, then parses the project
for several seconds before its first connection, and opens more connections while it runs. A
raw-lake query (`lake_query` over MCP, the CLI or the console) for the same tenant opened in
that window rotated the dbt login's password, and dbt's four threads were refused:

```
FATAL:  password authentication failed for user "undercroft_dbt_case_0042"
```

dbt exits 2 before any model, and the build fails whole. Seven builds of one tenant failed this
way in a morning, each paired in the Postgres log with a query that started inside that window;
none of the builds that succeeded had one. The same morning the BI login collided with
itself: sessions opened together each ran `ALTER ROLE … PASSWORD` on it, Postgres answered
`tuple concurrently updated`, and the requests that opened them failed.

The failure was hard to see because the run kept only the first 500 characters of dbt's last
lines: the startup banner filled them, and "Encountered an error: … password authentication
failed" was cut off at its first letter (issue #336).

## Decision

- **The worker leases a login.** One lease per (tenant, login kind), in the worker's memory. The
  first holder rotates the password, as before. A holder that arrives while the login is held
  shares that password. When the last holder lets go, the next one rotates again. So the
  password still changes between uses, and never during one.
- **A holder states how long it needs the login.** A pooled session needs it to open, a build
  for its whole deadline. When the shared password has less left than a newcomer needs, the
  worker extends its expiry with `ops.extend_tenant_password` rather than replacing it. The new
  function sets only `VALID UNTIL`, never earlier than it was; like the rotation it is
  `SECURITY DEFINER`, executable by the worker alone, and it reads and returns no password.
- **Taking a lease is serialised per login; holding one is not.** Two holders arriving together
  cannot both decide to rotate, and a query never waits for a build to finish.
- **`TenantSessions` is the one door.** `as` opens a pool on a lease; `withPassword` hands a
  leased password to a child that logs in by itself, which is dbt. `runTransform` no longer
  calls the rotation directly.
- **A build that stops before its first model records dbt's own cause** (#336): the run's
  error starts at dbt's "Encountered an error:" line, without the timestamps dbt stamps on each
  line, and dbt runs with `--no-use-colors`. The 500-character bound stays, and cuts the cause
  at its end.

## Consequences

- A tenant's password is in the worker's memory for as long as any build or session of that
  login runs, rather than for one of them. It is still never written anywhere, and it still
  changes with every burst of use; `.claude/rules/privileges.md` says so.
- The lease is only correct while one worker process is the only caller of the rotation. A
  second worker replica would need the lease moved into Postgres (an advisory lock around the
  rotation, and the holders counted in a table). Today there is one worker, and nothing else
  rotates a tenant password.
- The console's one-at-a-time queue (ADR 0038) is no longer needed for correctness. It stays;
  running panes in parallel is a separate change.

## Options rejected

- **A per-(tenant, login) mutex around each session**, ADR 0038's first suggestion. A build
  holds its login for up to half an hour, so every raw-lake query of the tenant would queue
  behind it.
- **A single retry on an authentication failure.** It does not cover dbt, which is a child
  process that sees only the refusal, and a retry that rotates again refuses the other holder.
- **A long-lived password per login, minted once per worker process.** It removes the race but
  keeps one password valid for the life of the process, which is the standing credential ADR
  0018 set out not to have.
- **A second, read-only login per tenant for raw-lake queries.** It separates the query from
  the build, but not two builds, two queries, or a dashboard's tiles from each other; it is a
  new role in the grant model for a race the lease closes for every caller.
