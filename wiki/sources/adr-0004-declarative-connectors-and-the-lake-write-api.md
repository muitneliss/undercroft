---
title: ADR 0004 Declarative Connectors and the Lake Write API
type: source
date: 2026-09-18
tags: []
source: docs/adr/0004-declarative-connectors-and-the-lake-write-api.md
source_path: docs/adr/0004-declarative-connectors-and-the-lake-write-api.md
source_hash: 2aeef5ff5e328e053408c74553b0fc93b3c79611d60a08ced7c639a801eb7de8
ingested: 2026-09-18
---

# ADR 0004 Declarative Connectors and the Lake Write API

## Decision

A REST source is a YAML spec (base URL, auth, pagination, entities, cursor), validated by
Zod and executed by one generic runtime. There is **no code per source**. Alongside it the
worker exposes a plain-REST lake write API so a Kestra task, a shell script or a
third-party tool can land data through the same create-only, content-addressed path.
One writer (the lake), many callers.

## Why

The predecessor's per-source connectors were configuration wearing a code costume: their
entire variable content was an entity list, a property list, an envelope key, an id field,
a paginator type and a pacing number — exactly a spec's fields. Making them YAML means a
user adds a source with no code and no migration.

The lake API exists because a spec cannot express everything (a bespoke crawl, XML, HMAC
signing, a CSV drop). Rather than grow the format for every exotic source, such a source is
landed by an external caller through the API. That release valve is why an incomplete
format is survivable, and why `apiVersion` is versioned.

## Rejected

* **A per-source code plugin system.** Reintroduces the hand-written connector.
* **Adopting a foreign connector protocol (Singer/Airbyte).** Both are container/runtime
  protocols, reintroducing the ingestion platform this architecture avoids.

## Note on orchestration

Kestra orchestrates but does not ingest: it calls the worker's HTTP verb allowlist and
holds no Docker socket, so a Kestra compromise is not a host compromise.

## Related

The create-only path this API writes through is
[[ADR 0001 Raw Lake Is the Only Durable Layer]]; the table records land in is
[[ADR 0002 One Generic Raw Table, No Business Schema]].

**Superseded in part:** the clause about dbt running in its own container was replaced by
[[ADR 0007 dbt Runs as a Subprocess in the Worker]].
