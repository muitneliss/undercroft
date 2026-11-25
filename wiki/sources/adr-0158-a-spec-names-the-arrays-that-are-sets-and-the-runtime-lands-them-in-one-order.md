---
title: >-
  ADR 0158 A Spec Names the Arrays That Are Sets, and the Runtime Lands Them in
  One Order
type: source
date: 2026-11-25
tags: []
source: docs/adr/0158-a-spec-names-the-arrays-that-are-sets.md
source_path: docs/adr/0158-a-spec-names-the-arrays-that-are-sets.md
source_hash: 079c82495c737f1f24f0799328600e70854b644b398829ab616e1b0b76a9c24a
ingested: 2026-11-25
---

# ADR 0158 A Spec Names the Arrays That Are Sets, and the Runtime Lands Them in One Order

HubSpot's v4 association batch read answers `to` and `to[].associationTypes` as sets in an order that changes between calls, and `canonicalJson` (which sorts keys but rightly leaves arrays alone) hashed each shuffle as a new version. Measured on one tenant: `contact_companies` held about 6,100 records and about 190,600 lake versions, roughly thirty-one per record alternating between two payloads; `associations` and `quote_companies` showed the same at about 15,000 and 9,000.

**Decision.** An entity declares `unorderedArrays`: dotted paths of names where `name[]` steps into each element and the path ends at the array (`to`, `to[].associationTypes`), no `[n]` index. The runtime sorts each declared array by its elements' canonical JSON, deepest path first, before the payload is canonicalised; a path that reaches no array leaves the record as sent. The **sorted form is what is stored**, so the stored bytes are the bytes the digest is of and `LakeStore` stays ignorant of specs. One public function does it: `canonicalPayload(payload, unorderedArrays)` in `@undercroft/connector-runtime`, called by the runtime's `outOf` after documents are taken out ([[ADR 0101 A Spec Lands the Text a Person Wrote as a Document of Its Record]]), and by anything that re-canonicalises a payload already in the lake. Every HubSpot v4 association entity declares `[to, "to[].associationTypes"]`. Undeclared arrays keep their order: never guess.

**Consequences.** Each affected record lands at most one more version after the change, then stays `unchanged`; existing versions are untouched (raw is create-only) and removing the flip-flop history is a separate compaction that must use the same function.

**Rejected.** Sorting every array in `canonicalJson` (loses meaningful order everywhere); semantic comparison inside `LakeStore` (a source fact in the one writer, and no longer addressed by bytes); hashing the sorted form but storing bytes as sent (two byte strings at one address); a sort in HubSpot template code (not general); sorting by a declared key (needs keys and tie rules, and a guess for elements without one).
