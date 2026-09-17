# 3. A TypeScript monorepo on Bun, with tRPC

- Status: Accepted
- Date: 2026-09-17

## Decision

The platform is 100% TypeScript, in a Bun-workspace monorepo. Bun is the runtime, package
manager, workspace manager and test runner. The control plane and the React UI share types
through tRPC.

## Why

The predecessor split Python (backend) and TypeScript (UI), which forced a hand-mirrored
DTO layer and a lint rule whose only job was to stop money drifting between the two
representations. tRPC deletes that class of bug: the client imports the router type
directly, so client and server cannot disagree about a shape.

One runtime and one test runner means one definition of "green"; a second toolchain is how
two definitions drift apart.

## dbt is not a Python exception

dbt-core is Python, but it is an _invoked dependency in its own container_ — the same
category as Postgres, MinIO, Kestra and Metabase. We never import it, ship it or maintain
it. It is Apache-2.0 and invoked, not vendored, so MIT distribution is unaffected.

## Rejected

- **Keeping Python for the backend.** Retains the two-language mirror and its whole class
  of drift bugs.
- **A hand-rolled SQL transform runner instead of dbt.** Rebuilds dbt's ref() DAG, tests,
  docs and incremental models badly.

## Risk

There is no dlt-equivalent declarative REST framework in TypeScript, so the connector
runtime is ours to maintain. The design is proven; the code is new.
