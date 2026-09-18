---
title: ADR 0003 TypeScript Monorepo on Bun with tRPC
type: source
date: 2026-09-18
tags: []
source: docs/adr/0003-typescript-monorepo-on-bun-with-trpc.md
source_path: docs/adr/0003-typescript-monorepo-on-bun-with-trpc.md
source_hash: ae930fc75a551b591fb9ece4a5d808c2394c16603dd1520f78ff5763fcb95d12
ingested: 2026-09-18
---

# ADR 0003 TypeScript Monorepo on Bun with tRPC

## Decision

The platform is 100% TypeScript in a Bun-workspace monorepo. Bun is the runtime, package
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

dbt-core is Python, but it is an *invoked dependency in its own container* — the same
category as Postgres, MinIO, Kestra and Metabase. It is never imported, shipped or
maintained here. Apache-2.0 and invoked rather than vendored, so MIT distribution is
unaffected.

## Rejected

* **Keeping Python for the backend.** Retains the two-language mirror and its whole class
  of drift bugs.
* **A hand-rolled SQL transform runner instead of dbt.** Rebuilds dbt's `ref()` DAG, tests,
  docs and incremental models badly.

## Risk

There is no dlt-equivalent declarative REST framework in TypeScript, so the connector
runtime is ours to maintain. The design is proven; the code is new.

## Related

The dbt container boundary stated here was later revised by
[[ADR 0007 dbt Runs as a Subprocess in the Worker]]. The money-handling gaps TypeScript
introduces are answered in [[ADR 0006 Money as a String and Microsecond Stamps]].
