---
title: ADR 0074 The Card Judges A Grant By The Lists It Reads
type: source
date: 2026-09-28
tags: []
source: docs/adr/0074-the-card-judges-a-grant-by-the-lists-it-reads.md
source_path: docs/adr/0074-the-card-judges-a-grant-by-the-lists-it-reads.md
source_hash: fe5d3a1e95c77007a1a877913f1c60bd3bea8b84edb7465976ddb21a894b4c2d
ingested: 2026-09-28
---

# ADR 0074 The Card Judges A Grant By The Lists It Reads

# ADR 0074 The card judges a grant by the lists it reads, from the spec the run reads

Status: Accepted, 2026-09-28. Issue 277. Supersedes one consequence of
[[ADR 0073 A List Its Grant Cannot Read Is Named Not Failed]]: that every connection whose grant
lacks part of the consent reads **reconnect** on its card. ADR 0073's decisions stand.

## Context

After ADR 0073 a run read every list its grant reaches, but `presentStatus` still showed
`needs_reconnect` for any grant short of the whole consent. Every Xero connection made before the
consent asked for `accounting.settings.read` read "lapsed", with no **Run now** and no schedule
shown, although its grant still reads twelve lists. The scheduler was not stopped: the due list
(`listDueCandidates`) and `nextRunAt`/`isDue` read the stored `ops.connection.status`, and
`needs_reconnect` for a narrow grant is a card-only derivation. The card needed each list's
`readScope`, which lives in the spec, and the control plane read no specs.

## Decision

* A grant that lacks some of the consent is runnable while it still reads a list the connection
  would read: the card is `connected`, with Run now and its schedule, and carries `ungranted` (the
  lists a run skips and the scope each needs). The card words one sentence per missing permission
  and its primary plate is Reconnect.
* A grant that reads none of those lists, or lacks a capability gating no list (Xero's
  `offline_access`), stays `needs_reconnect`. Gmail and Drive read under one scope and are unchanged.
  An empty recorded grant is still not judged.
* One rule: `partitionByGrant` moves to `@undercroft/contracts` (`specGrant.ts`) and applies the
  admin's Xero choice as well as the grant; the worker's `openSpecRun` and the card's
  `presentStatus` both call it.
* The control plane reads `specs/connectors/*.yaml` at boot (`apps/control-plane/src/specs.ts`, via
  `imageFiles.ts`), and its Dockerfile copies `specs` as the worker's does. `ServerDeps.specReads`
  reaches the tRPC context and `connections.list`. A spec that fails to read is logged and that
  source's grant is judged whole.

## Rejected

A per-list scope table in the control plane or UI (a third copy of `readScope`); asking the worker
(the most-visited page would depend on a second process); reading the last run's
`entity_not_granted` warnings (absent before a first run, stale after a reconnect); a fifth card
state.
