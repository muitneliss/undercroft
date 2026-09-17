# 4. Declarative connectors, with the lake API as the only writer

- Status: Accepted
- Date: 2026-09-17

## Decision

A REST source is a YAML spec (base URL, auth, pagination, entities, cursor), validated by
Zod and executed by one generic runtime. There is no code per source. Alongside it, the
worker exposes a plain-REST lake write API so a Kestra task, a shell script or a
third-party tool can land data too — through the same create-only, content-addressed path.
One writer (the lake), many callers.

## Why

The predecessor's per-source connectors were configuration wearing a code costume: their
entire variable content was an entity list, a property list, an envelope key, an id field,
a paginator type and a pacing number — exactly a spec's fields. Making them YAML means a
user adds a source with no code and no migration.

The lake API exists because a spec cannot express everything (a bespoke crawl, XML, HMAC
signing, a CSV drop). Rather than grow the format for every exotic source, such a source is
landed by an external caller through the API. That release valve is why the format being
incomplete is survivable, and why `apiVersion` is versioned.

## Rejected

- **A per-source code plugin system.** Reintroduces the hand-written connector.
- **Adopting a foreign connector protocol (Singer/Airbyte).** Both are container/runtime
  protocols — reintroducing the ingestion platform this architecture avoids.

## Note

Kestra orchestrates but does not ingest: it calls the worker's HTTP verb allowlist and
holds no Docker socket, so a Kestra compromise is not a host compromise. dbt runs in its
own container invoked by the worker over that same allowlist, keeping the socket rule
intact.
