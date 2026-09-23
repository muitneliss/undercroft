---
description: The declarative connector contract
paths: ["packages/connector-runtime/**/*.ts", "specs/**/*.yaml"]
---

# Connectors are configuration, not code

A source is a YAML spec validated by `@undercroft/contracts`, executed by the generic
runtime. Adding a REST source is a file and no migration.

## NEVER

- **NEVER return an empty stream on failure.** Any failure raises a `ConnectorError` whose
  message carries how many records were seen — "failed after 412" is a transient fault,
  "failed after 0" is a credential problem, and they want different responses.
- **NEVER land a record under a guessed key.** A record with no value at its `idPath` is
  fatal for that record, not a silent skip.
- **NEVER re-serialise a payload through `JSON.parse`/`JSON.stringify`.** Numbers must stay
  exact; the runtime canonicalises the lossless-parsed record so the same record always
  hashes to the same bytes.

## Follow

- The spec shape is proven (modelled on dlt's REST config). What a spec cannot express
  goes through the lake write API as an external caller — the release valve that keeps the
  format from having to grow for every exotic source.
- Pacing, retry and path extraction come from `@undercroft/core` on an injected `Clock`,
  so rate-limit behaviour is tested without waiting.
- Every shipped spec is validated by `bun run spec:validate`, which is in the gate.
- **A source whose content is bytes is code, not a spec.** Gmail and Drive live in
  `apps/worker/src/services/google/` because the runtime's `HttpResponse.text` is a string by
  construction, and a PDF that has been through it is unrecoverable. Adding a binary request
  kind would grow the format for two exotic sources and put bytes on the record loader's
  path, where they become mojibake in a `jsonb` column. The valve is taken INSIDE the worker
  rather than by an external caller of the lake API, because the credential must not leave
  the one process holding `UNDERCROFT_SECRET_KEY`. ADR 0015.
- **What such a collector still reuses is everything the runtime got right**: `createPacer`,
  `withRetry` and `Clock` from `@undercroft/core`, and `ConnectorError` carrying how many
  records were seen. A collector that re-implemented pacing would be a second place for a 429
  to go unhandled.
