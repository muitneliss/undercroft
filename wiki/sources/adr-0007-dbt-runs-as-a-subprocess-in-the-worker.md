---
title: ADR 0007 dbt Runs as a Subprocess in the Worker
type: source
date: 2026-09-18
tags: []
source: docs/adr/0007-dbt-runs-as-a-subprocess-in-the-worker.md
source_path: docs/adr/0007-dbt-runs-as-a-subprocess-in-the-worker.md
source_hash: 0e0d7c2b4c7684296a2a49a710eb0a87eea9cfaf472cd0900db087e94be637ab
ingested: 2026-09-18
---

# ADR 0007 dbt Runs as a Subprocess in the Worker

## Decision

The `dbt` binary is installed in the worker image. `POST /v1/runs/transform` spawns
`dbt build` as a subprocess and reports its exit status. Still no Python is written and
nothing is imported from dbt.

**Supersedes** the "dbt runs in its own container, invoked by the worker" clause of
[[ADR 0004 Declarative Connectors and the Lake Write API]].

## Why the earlier phrasing did not survive contact

ADR 0004's wording is not implementable without one of two things this stack refuses:

* **Kestra's dbt plugin** runs dbt in a container it starts, which needs the Docker socket.
  Mounting the socket into the scheduler turns a Kestra compromise into a host compromise —
  the exact reason Kestra is socket-free here.
* **The worker starting a container** needs the same socket, for the same cost.

A third option — a long-running dbt sidecar with its own HTTP trigger — means writing and
securing a second service whose only job is to shell out to a binary. That is more surface,
not less.

So the container boundary moves: dbt is a *binary in the worker image*, in the same
category as `pg_dump`. "No Python in our source" is unchanged — none is authored, imported
or maintained.

## Cost, stated plainly

The worker image carries a Python runtime and dbt's dependency tree, so it is substantially
larger than a Bun-only image. That is the price of keeping every service in this stack away
from the Docker socket.

## What does not change

dbt still runs as `undercroft_dbt`, whose privileges are what make it safe to execute SQL a
user wrote: no USAGE on `app`, create only in `analytics` and `dq`, `store_failures` pinned
to `dq`. The privilege model in [[ADR 0005 The Role and Grant Model]] is the control — not
the container boundary.
