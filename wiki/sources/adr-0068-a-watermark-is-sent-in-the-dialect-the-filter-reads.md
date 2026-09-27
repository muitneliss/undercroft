---
title: ADR 0068 A Watermark Is Sent in the Dialect the Filter Reads
type: source
date: 2026-09-27
tags: []
source: docs/adr/0068-a-watermark-is-sent-in-the-dialect-the-filter-reads.md
source_path: docs/adr/0068-a-watermark-is-sent-in-the-dialect-the-filter-reads.md
source_hash: 272229002ccfa9ae71f1018f7ff62977bb18150a5fc192402f5a9950bfe83a5e
ingested: 2026-09-27
---

# ADR 0068 A Watermark Is Sent in the Dialect the Filter Reads

# ADR 0068 A Watermark Is Sent in the Dialect the Source's Filter Reads

Status: Accepted, 2026-09-27. Supersedes, in part, the "stored and sent back verbatim" decision of
[[ADR 0034 The Watermark Is a Table Not a Max]]: storage stays verbatim, sending is decided here.

## Context

ADR 0034 assumed Xero's `If-Modified-Since` is a datetime string, so its own text could be sent
back. Xero READS that header as RFC 3339 but WRITES every record date as a Microsoft JSON date,
`/Date(1573755038314+0000)/`. Issue #265:

* `updatedAtPath: UpdatedDateUTC` passed `/Date(...)/` to `raw.records.source_updated_at`
  (`timestamptz`); Postgres refused it and the first Xero run landed nothing. The lake manifests
  that run wrote carry the same text, cannot be rewritten, and failed every later projection pass.
* `incremental.format` knew only `iso8601`, `epoch-millis`, `yyyy-mm-dd`; `Date.parse` gave `NaN`,
  so the Xero watermark never advanced and every run was a full read.

## Decision

* **One reader of timestamp text**, `isoInstant` in `packages/core/src/instant.ts`: ISO-8601 with
  `Z` or an explicit offset is handed back unchanged; a Microsoft JSON date is rendered as ISO-8601
  UTC (the count is UTC epoch milliseconds; the offset does not move it); anything else is `null`
  (no time, no offset, `"March 7"`, `2026-02-30`). Used by the connector runtime for
  `sourceUpdatedAt` and by `loadToRaw` for every manifest, so old manifests project and an
  unreadable one becomes `NULL` instead of blocking the stream's cursor. The payload keeps the text.
* **`incremental.format: ms-json-date`** orders by the count inside `/Date(...)/` as a `bigint`.
* **`incremental.send`: `verbatim` (default) or `rfc3339-seconds`.** The cursor still stores the
  source's text; `send` only decides what goes into the `param`/`header`. `rfc3339-seconds` renders
  UTC rounded down to the second (`2019-11-14T18:10:38Z`): rounding down can only ask for more.
  `xero.yaml` declares both on all four entities. A watermark it cannot render raises a
  `ConnectorError`, since sending nothing would be a full read with `failOnEmpty` relaxed.

## Rejected

Sending `/Date(...)/` verbatim once orderable (a header Xero does not read); tying the rendering to
`format` (hides a fact about one provider's filter); an `updatedAtFormat` spec field (`loadToRaw`
has no spec and must read old manifests); raising on an unreadable `updatedAt` (how #265 lost the run).
