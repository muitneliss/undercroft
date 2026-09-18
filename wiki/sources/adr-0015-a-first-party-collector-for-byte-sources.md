---
title: ADR 0015 A First-Party Collector for Byte Sources
type: source
date: 2026-09-18
tags: []
source: docs/adr/0015-a-first-party-collector-for-byte-sources.md
source_path: docs/adr/0015-a-first-party-collector-for-byte-sources.md
source_hash: 095a1b2473932c75732f7570080f5d1fcbf4cead59d7f2cf814ced561ec074bd
ingested: 2026-09-18
---

# ADR 0015 A First-Party Collector for Byte Sources

# ADR 0015 A First-Party Collector for Byte Sources

## Decision

**Gmail and Google Drive are ingested by code, not by a YAML connector spec.** They live in
`apps/worker/src/services/google/` and enter through the same `runIngest` door as a spec-driven
source, so no caller has to know which kind it asked for. `packages/contracts/src/connectorSpec.ts`
is deliberately NOT extended with a binary request kind.

## Why the spec format cannot express them

Three reasons, none cosmetic:

* **`HttpResponse.text` is a string.** `createFetcher` consumes every body with `response.text()`,
  so a PDF's bytes are gone before anything downstream sees them, and re-encoding the string does
  not recover them.
* **Neither request shape is expressible.** Gmail's `labelIds` parameter is AND rather than OR, so
  a selection of three labels is three paged queries unioned client-side. Drive's file content
  comes from `?alt=media` rather than a JSON envelope. No pagination kind or path extractor
  describes either.
* **`readEntity` yields `payloadText`.** A binary yield cannot use it, and `loadStreamToRaw`
  decodes every journalled object as JSON text for `payload jsonb` — a PDF on that path becomes
  mojibake in a jsonb column.

## Options rejected

**Adding a `download` request kind to the spec.** It would require a bytes channel on the
`Fetcher` seam that four working connectors do not need, a second paced-and-retried fetch path
beside `fetchJson`, a `RawRecordOut` that is sometimes not a record, and a regenerated JSON schema
the gate does not check. The format would grow for two exotic sources and every later reader would
carry the complexity.

**Landing through the lake write API as an external caller** — the letter of ADR 0004's release
valve. Rejected on where the credential would have to live: an external caller needs a token, and
only the worker may open a sealed credential because only it holds `UNDERCROFT_SECRET_KEY`. A
collector outside the worker means either a second holder of the master key or a credential
travelling further than it must.

## Consequences

* **The valve is taken inside the worker.** ADR 0004 said what a spec cannot express is landed by
  a caller of the lake API; this is that, with the caller in the same process as the store. The
  property preserved is ADR 0005's — the credential never leaves the process that can open it.
* **`raw.documents` is used for the first time.** It has existed since `030_raw.sql` with grants in
  `040_grants.sql` and no TypeScript behind it. Nothing new was designed for bytes; a table the
  schema already anticipated was filled in.
* **A PII boundary became load-bearing and is written down.** `raw.documents` is granted to
  `undercroft_dbt`, so its columns — `lake_key` included — are one `dbt run` from a dashboard.
  Opaque provider ids, timestamps, enumerated types and counts go in the row; anything a human
  wrote (filename, mail subject, address, folder name) goes in the lake manifest, which dbt and BI
  cannot reach. `landDocuments` takes them as two separate arguments so the split is visible at
  every call site. Recorded in `.claude/rules/pii.md`.
* **What the runtime already got right is not rebuilt.** Pacing, retry and back-off come from
  `@undercroft/core` on an injected `Clock`, so a 429 is exercised in the offline gate with nothing
  sleeping.
* **A third source of this shape would be a third module.** That is the accepted cost. A fourth
  reopens the question of a byte-capable spec format, with a new ADR superseding this one.

See also: ADR 0004 (declarative connectors and the lake write API), ADR 0005 (the role and grant
model), ADR 0016 (the worker seals, the control plane consents).
