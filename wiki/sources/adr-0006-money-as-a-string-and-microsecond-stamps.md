---
title: ADR 0006 Money as a String and Microsecond Stamps
type: source
date: 2026-09-18
tags: []
source: docs/adr/0006-money-and-time-in-typescript.md
source_path: docs/adr/0006-money-and-time-in-typescript.md
source_hash: f78fe9578407f292304360b2f19c7cf97c82440d0875a06b17df103b233b616d
ingested: 2026-09-18
---

# ADR 0006 Money as a String and Microsecond Stamps

## Decision

Money is a `big.js` decimal internally and a **string at every boundary** (wire, DB, JSON).
`parseAmount` returns `null` for anything ambiguous and throws on a `number`. `pg` numeric
and int8 parsers are pinned to strings. Content addressing uses a canonical JSON serializer
that emits numbers verbatim from a lossless parse. Observation stamps carry microsecond
precision from a strictly-increasing source. Structured logs are JSONL to stdout.

## Why

TypeScript is weaker than the Python it replaces in three specific, expensive ways, each
needing a deliberate answer:

* **`JSON.parse` destroys money before you can defend it** — every number becomes a double,
  with no `parse_float` hook. So the lake stores and hashes bytes; the `raw.records` payload
  is cast to jsonb by Postgres from the lake's text, never re-serialised in JS; and `big.js`
  (which throws on bad input rather than returning `NaN`) is the only decimal.
* **`JSON.stringify` is not a canonical serializer** — no sorted keys, no `ensure_ascii`,
  and RFC 8785 would reintroduce the float. `canonicalJson` sorts by code point, escapes to
  ASCII, and writes numbers verbatim from `lossless-json`.
* **`Date` is millisecond, but the stamp format is microsecond** — a widening the
  predecessor made *because* second precision rejected real data during backfills. A
  monotonic `StampSource` keeps six strictly-increasing digits.

## Rejected

* **`decimal.js`.** Returns `NaN` on bad input, which propagates silently and prints as a
  value — the opposite of "never guess".
* **File logging under a lock.** Node has no portable advisory lock; writing JSONL to stdout
  removes the corruption failure mode rather than reimplementing it badly. Consequence: no
  on-disk log without a shell redirect.

## Related

The TypeScript-only choice that created these gaps is
[[ADR 0003 TypeScript Monorepo on Bun with tRPC]]. Content addressing depends on the
canonical serializer described here — see
[[ADR 0001 Raw Lake Is the Only Durable Layer]].
