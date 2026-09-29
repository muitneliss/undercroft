---
title: "Raw data lake: immutable storage on S3 and MinIO"
description: "Learn how an immutable raw data lake on S3 or MinIO preserves source bytes, deduplicates content, and lets you rebuild Postgres tables and dbt models."
translationKey: "raw-data-lake"
pubDate: "2026-09-29"
tags: ["Data lake", "Architecture", "ELT"]
keywords:
  [
    "raw data lake",
    "data lake",
    "immutable data",
    "s3 data lake",
    "minio data lake",
    "data lake vs data warehouse",
  ]
hero: "../../../assets/posts/raw-data-lake/hero.png"
heroAlt: "Stone arches shelter a raw data lake on S3 or MinIO beneath rebuildable Postgres, dbt models, and dashboards"
---

A raw data lake preserves the source material behind your reports before your reporting logic decides what matters. In Undercroft, that means immutable, content-addressed storage on S3 or MinIO. The lake is the only durable data layer: Postgres tables, dbt models, and the data feeding dashboards are projections you can drop and rebuild from what the lake retains.

That distinction matters when a source changes yesterday's record or deletes an attachment. Re-running SQL can repair a calculation. Calling the source again cannot reliably recover bytes it no longer serves. The design therefore protects captured data first, then makes it useful through queryable projections.

## What is a raw data lake, and what does it preserve?

A data lake holds source material before it has been shaped into a particular reporting schema. In Undercroft, the raw lake stores the bytes handed to its write path, alongside manifests describing observations. A manifest connects those bytes to a source key, a run, and an observation time.

This separates two questions: what content did we receive, and where did we observe it? A document can arrive through several source records without requiring several copies of its bytes. Conversely, one source record can change over time and acquire several retained observations.

Raw means the input captured by the pipeline, not a promise that every field or every historical version in a remote application has been collected. If a connector never fetched something, the lake cannot reconstruct it. The [guide to REST API data integration](/en/data-integration-rest-api-yaml-connectors/) explains the ingestion side of that boundary.

The practical benefit is independence from today's model. A field that looks irrelevant during the first reporting project can become useful later, provided it was captured and retained.

## Why should immutable data be the only durable layer?

Consider an illustrative operations team that changes its definition of an overdue item. Its old dashboard groups records incorrectly, but the captured source payloads still contain the fields needed for the corrected rule. The team can change its model and rebuild the result.

Now consider the opposite: the team kept only a monthly total, discarded the input, and the source later changed. No SQL correction can reveal which original records produced that total. The information was lost before the reporting bug was discovered.

Undercroft makes that asymmetry an architectural rule. Captured raw data is the evidence; derived tables express an interpretation of it. If a curated table contains the only copy of information, that information should have entered raw first.

“Durable” here identifies the layer the architecture depends on preserving. It does not promise that a bucket survives every infrastructure failure, or that an application-level create-only rule is a storage-provider retention lock. The lake remains the data you cannot recover merely by rebuilding downstream tables.

## How do content hashes and create-only writes work?

`LakeStore` hashes incoming bytes with SHA-256. The digest determines the blob's address. The actual key function in `packages/lake/src/keys.ts` is short:

```typescript
export function blobKey(digest: string): string {
  return `_blobs/${digest.slice(0, 2)}/${digest}`;
}
```

The source identity lives separately in the observation's manifest. A new observation references the blob instead of embedding another copy of its content.

1. The store validates the source key and hashes the incoming bytes.
2. It compares that digest with the newest observation at the same source key.
3. If they match, it returns `unchanged` without writing a blob or a new manifest.
4. Otherwise, it creates the blob if absent and creates a new observation manifest. An attempt to replace an existing observation raises an error.

![Two writes of identical bytes at the same source key produce the same SHA-256 hash and share one create-only blob; the repeat returns unchanged](../../../assets/posts/raw-data-lake/flow.png)

The diagram shows a repeated write at one source key. Identical bytes arriving at a different source key can still create a separate observation while sharing the existing blob. A change from content A to B and back to A also records a new observation of A, reusing its blob if it remains present.

This is byte identity, not semantic similarity. Two documents that look alike can have different bytes and therefore different hashes. When the store reads an observation, it hashes the retrieved bytes again and rejects a mismatch instead of returning suspect content.

## What is the difference between a data lake and a data warehouse?

For a data lake vs data warehouse comparison, start with their roles. The lake preserves captured input; a warehouse organises data for analysis. Undercroft implements the downstream analytical layer with Postgres and user-authored dbt models, rather than requiring a separate warehouse engine.

| Layer                     | What it represents                       | What a rebuild depends on                                           |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Raw lake on S3 or MinIO   | Captured bytes and observation manifests | Preserving those objects; missing source history cannot be invented |
| `raw.records` in Postgres | A queryable projection of source records | Retained lake observations and the loader                           |
| dbt models and marts      | Business definitions expressed in SQL    | Their model definitions and upstream data                           |
| Dashboard results         | A presentation of modelled data          | The underlying projections and reporting definitions                |

The word `raw` in `raw.records` does not make Postgres the archive. Source records share one generic table, keyed by source, tenant, entity, and source record ID, with a `jsonb` payload. Undercroft ships no business schema for customers, deals, or invoices.

Your dbt project supplies those meanings. The [Xero reporting guide with SQL and dbt](/en/xero-reporting-sql-dbt/) shows how this separation supports reporting without asking the ingestion platform to own your business definitions.

## Does deduplication erase a document's history?

It should not. Sharing storage and preserving provenance solve different problems. Imagine the same attachment appearing in several messages: its bytes need one blob, but the fact that each message carried it is still useful information.

Undercroft's `raw.documents` catalogue preserves those separate occurrences. Its rows are addressed by provenance, so several rows can reference the same digest. Blob deduplication does not imply one catalogue row per file's content.

The extraction layer also recognises identical bytes, reusing an extraction within the same tenant and source. That scope matters: it does not reuse extracted text across tenants or across different sources. The Lake view reports document counts alongside distinct blob counts and sums content bytes over distinct blobs.

Those figures answer different questions. “How many document occurrences did we collect?” is not the same as “How many distinct payloads do they reference?” Keeping both avoids mistaking repeated evidence for additional stored content.

## What happens when an ingest crashes or a projection is rebuilt?

Durability starts when data lands. Holding an entire source in memory until a run finishes would leave nothing durable if the process died first. Undercroft's ingestion paths stream their inputs, land chunks, and keep the Postgres projection moving with them.

The next run can project observations already held in the lake and use the records it holds to avoid unnecessary source reads. The lake's journal lets the loader advance through new observations with a cursor instead of rediscovering every record's history.

Rebuildable still has an operational cost. `raw.records` also helps determine what has already been fetched. Dropping it can remove that knowledge, so a subsequent sync may incur first-sync source reads; plan recovery around that cost rather than assuming a rebuild is free.

For a concrete ingestion example, the [Gmail-to-database guide](/en/gmail-integration-email-to-database/) covers the path from messages and documents to queryable data. The lake protects what landed, while the ingestion logic determines what gets fetched next.

## How does retention work in an immutable raw data lake?

Create-only storage does not mean every observation must remain forever. It means an existing observation is not silently replaced. A retention policy is a separate, explicit decision about which observations remain available.

The current `LakeStore` default keeps every observation: no retention limit is configured. When a limit is supplied, it is a count per source key, with a minimum of one. Pruning removes the oldest excess observations and returns their stamps; a write exposes that result through `pruned`.

This is what bounded and reported retention means here. It is not an automatic age-based policy or a guarantee that total storage stays below a byte budget. Repeating the newest identical content produces no extra observation, so routine unchanged writes do not crowd real versions out of the count.

Pruning observations does not delete shared blobs. Another source key may still reference the same bytes, so blob garbage collection requires a separate deliberate decision. A smaller observation count therefore does not promise an immediate reduction in stored blob bytes.

## Can the raw lake use S3 or self-hosted MinIO?

Yes. The storage adapter supports S3 and an S3-compatible endpoint such as MinIO. An S3 data lake and a MinIO data lake use the same `LakeStore` rules for content addressing, observations, and retention.

The repository's compose setup uses the `pgsty/minio` and `pgsty/mc` community builds, pinned by release tag, as recorded in ADR 0050. This is an operational dependency worth making explicit when discussing the self-hosted deployment.

You can inspect that decision and the write implementation in the [Undercroft open-source repository](https://github.com/muitneliss/undercroft). The important continuity is the captured bytes and their manifests: changing a storage deployment must preserve the layer from which everything else is rebuilt.

## FAQ

### Is a raw data lake just a copy of Postgres?

No. In Undercroft, Postgres source tables are projections of lake observations, while the lake also holds document bytes. Copying a queryable table alone does not preserve that underlying material.

### Does writing the same data twice create two objects?

Repeating the newest identical bytes at the same source key returns `unchanged` and writes nothing. Different source keys can share one content blob while retaining separate observation manifests.

### Can I query the raw lake with SQL?

SQL works over its Postgres projections rather than directly over arbitrary S3 objects. The admin-only Lake search also searches record values and extracted document text, with Vietnamese diacritic-insensitive matching and English stemming.

### Does immutable storage mean automatic permanent retention?

No: create-only writes and retention are separate rules, although the current default retains every observation. A configured count limit prunes old observations and reports them without automatically deleting shared blobs.
