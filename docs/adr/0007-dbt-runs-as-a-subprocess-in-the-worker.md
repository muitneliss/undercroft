# 7. dbt runs as a subprocess in the worker image

- Status: Accepted
- Date: 2026-09-17
- Supersedes: the "dbt runs in its own container, invoked by the worker" clause of ADR 0004

## Decision

The `dbt` binary is installed in the worker image. `POST /v1/runs/transform` spawns
`dbt build` as a subprocess and reports its exit status. We still write no Python and
import nothing from dbt.

## Why the earlier phrasing did not survive contact

ADR 0004 said dbt would run "in its own container invoked by the worker over the same
allowlist". That is not implementable without one of two things we refuse:

- **Kestra's dbt plugin** runs dbt in a container it starts, which needs the Docker socket.
  Mounting the socket into the scheduler turns a Kestra compromise into a host compromise —
  the exact reason Kestra is socket-free here.
- **The worker starting a container** needs the same socket, for the same cost.

A third option — a long-running dbt sidecar with its own HTTP trigger — means writing and
securing a second service whose only job is to shell out to a binary. That is more surface,
not less.

So the container boundary moves: dbt is a _binary in the worker image_, in the same
category as `pg_dump`. "No Python in our source" is unchanged — we author none, import
none, and maintain none.

## Cost, stated plainly

The worker image carries a Python runtime and dbt's dependency tree, so it is
substantially larger than a Bun-only image. That is the price of keeping every service in
this stack away from the Docker socket, and it is the right trade.

## What does not change

dbt still runs as `undercroft_dbt`, whose privileges are what make it safe to execute SQL a
user wrote: no USAGE on `app`, create only in `analytics` and `dq`, `store_failures` pinned
to `dq`. The privilege model (ADR 0005) is the control, not the container boundary.
