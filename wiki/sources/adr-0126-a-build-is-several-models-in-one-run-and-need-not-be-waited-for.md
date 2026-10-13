---
title: ADR 0126 A Build Is Several Models in One Run, and Need Not Be Waited For
type: source
date: 2026-10-13
tags: []
source: >-
  docs/adr/0126-a-build-is-several-models-in-one-run-and-need-not-be-waited-for.md
source_path: >-
  docs/adr/0126-a-build-is-several-models-in-one-run-and-need-not-be-waited-for.md
source_hash: f1c449af45ac8c8b798c130d5eb930347e67af33ac6315a64f0de0041bac8c3f
ingested: 2026-10-13
---

# ADR 0126 A Build Is Several Models in One Run, and Need Not Be Waited For

Amends the `models.build` consequences of [[ADR 0124 A Procedure That Waits Holds Its Request Open to Its Own Cap, and Nothing Else Does]]. Issues #442 and #441: in 2,433 MCP calls, 261 of 317 `models_build` calls came in back-to-back one-model streaks, 18 hit the client's timeout and 7 were refused with `CONFLICT` by the agent's own earlier build with no run id to wait on; the answer listed every dbt step and was the largest token sink.

**Decision.** (1) `models.build` declares `holdsOpenSeconds: 160` -- the control plane's 150 s wait on the worker (`BUILD_DEADLINE_MS`: a two-minute build including a 20-second wait for an editor turn, then steps, counts and preview) plus ten to answer, under Bun's 255; the CLI's request timeout rises from 120 to 180 s, above the longest hold. (2) `wait: false` answers `{ waited: false, runId }` once the worker has opened the run; the build continues with the same turn ([[ADR 0088 Tenant Logins Reach Postgres Through A Pooler And Runs Take A Turn]]), deadline and lock, and the caller waits with `runs.get` and `waitSeconds`; the waited answer is `{ waited: true, ... }`, one discriminated output. (3) `names` takes up to 20 selectors -- `name`, `+name`, `name+`, nothing else of dbt's grammar -- built as one `dbt build`, one argv item each; every bare name must be a model of the tenant, checked first, since a selector matching nothing is a green build of nothing. (4) A refused build names its holder: the worker's 409 run id plus `startedAt` from the ledger, as `CONFLICT` facts and in the sentence; a holder the ledger no longer has is not named. (5) The answer leads with `stepSummary` and the steps `steps` asks for (problems by default) through the same `reportSteps` as `runs.get`, plus `rowCounts` -- one per named model, counted as the BI login in a shared ten-second budget, `null` (never `0`) for a model that did not build in this run or a count not read; the preview stays for one named model; further pages come from `runs.get` on the build's run. (6) Worker and control plane tolerate each other's previous build: `model` is read as a one-model selection and sent beside `select` only for one plain model; the answer is parsed so a missing `rowCounts` reads as none counted.

**Rejected.** A separate `models.start`; dbt's full selector grammar; counting models a `+` reached; storing the count in the ledger.

**Consequences.** N related models are one call and one turn of the build lock; a host with a tool timeout under 160 s uses `wait: false` and `runs.get`; a build `CONFLICT` gives a run to wait on.
