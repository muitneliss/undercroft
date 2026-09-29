---
title: "Data integration with REST APIs and YAML connectors"
description: "Learn how data integration works with declarative REST API connectors: YAML specs, auth, pagination, watermarks, rate limits, and visible failures."
translationKey: "data-integration"
pubDate: "2026-09-29"
tags: ["Integration", "REST API", "ELT"]
keywords:
  [
    "data integration",
    "rest api integration",
    "api connector",
    "declarative connector",
    "data pipeline",
  ]
hero: "../../../assets/posts/data-integration/hero.png"
heroAlt: "Data integration sketch showing REST sources and Google byte collectors feeding one raw lake"
---

Data integration brings information from separate systems into a form you can use together. For an engineering or finance team, that might mean reading invoices from Xero, relationships from HubSpot, and supporting documents from Gmail or Google Drive. The work includes obtaining permission, reading complete results, preserving evidence, and deciding what those records mean in a shared report.

A REST API integration often starts as a short script. Keeping it reliable is the harder part: tokens expire, results span pages, requests get throttled, and a run can stop halfway through. Undercroft describes supported REST reads in YAML and executes them through a shared connector runtime, with raw data stored before business models are built.

## What is data integration, and where does a data pipeline fit?

Data integration is the broader task of making separate sources useful together. A data pipeline is the sequence that moves and processes the data. An API connector handles one part of that sequence: speaking a source's authentication, request, pagination, and change-tracking conventions.

Undercroft's record pipeline goes from REST APIs to an immutable raw data lake on S3 or MinIO, then to the generic `raw.records` table in Postgres. Your dbt models define the tables used for analysis and BI. There is no shipped business schema that decides what a customer, invoice match, or revenue metric means for you.

This separation matters when a report changes. You can rebuild a Postgres projection or revise a model using retained raw data. The connector does not need a new business table for every endpoint. The [immutable raw data lake guide](/en/immutable-raw-data-lake/) explains that foundation, while [ETL versus ELT](/en/etl-vs-elt/) explains where transformation belongs.

## What does a declarative REST API connector contain?

A declarative connector describes what the runtime should request instead of implementing another HTTP loop. Undercroft validates its YAML specs against a connector schema. The repository ships Xero and HubSpot specs with different authentication and pagination choices, demonstrating that the shared format handles more than one API shape.

| Concern          | What the spec declares                               | Why it matters                                                          |
| ---------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| Authentication   | Bearer token or OAuth configuration                  | Requests reach the intended account with its granted access.            |
| Endpoint         | Base URL, path, query, and request kind              | The read asks for the fields and records you intended.                  |
| Record identity  | `envelopePath` and `idPath`                          | The runtime finds records and their source IDs.                         |
| Pagination       | Page number, cursor, JSON next link, offset, or none | Reading one successful response is not mistaken for reading everything. |
| Incremental sync | Strategy, source field, format, and sending format   | Later reads can use a valid watermark.                                  |
| Reliability      | Pacing, retry policy, and guards                     | Throttling and incomplete reads have explicit behavior.                 |

For a REST source that fits this contract, its extraction logic can be configuration without a database migration. Making a new source available in the product still requires packaging the spec in the worker and adding it to the control plane's supported sources, followed by a release. It is not a claim that uploading arbitrary YAML creates a new connection screen.

The [Undercroft repository](https://github.com/muitneliss/undercroft) contains the specs and their schema. The project is open-source under MIT and currently identifies itself as pre-alpha.

## How do authentication and pagination work in YAML?

The HubSpot spec uses bearer authentication with a token obtained from the connection. Xero uses OAuth with refresh-token rotation and an account header carrying the external organisation ID. Credentials are connection data; they do not belong as literal secrets in a published YAML file.

Pagination also follows the endpoint. Xero's default starts at `page=1` and continues until an empty page. Endpoints that return their whole list without pagination override that default with `kind: none`. HubSpot uses next links or an `after` cursor, depending on the entity.

The following is the real invoices entity from `specs/connectors/xero.yaml`, shown as an excerpt. It inherits authentication, pagination, pacing, and retries from the surrounding spec; it is not a complete standalone connector.

```yaml
- name: invoices
  request: { kind: list, path: /Invoices, query: { pageSize: "500", unitdp: "4" } }
  readScope: accounting.invoices.read
  envelopePath: Invoices
  idPath: InvoiceID
  updatedAtPath: UpdatedDateUTC
  incremental:
    strategy: header
    header: If-Modified-Since
    sourcePath: UpdatedDateUTC
    format: ms-json-date
    send: rfc3339-seconds
```

Here, `envelopePath` locates the invoice array and `idPath` identifies each invoice. A missing ID raises an error rather than producing a guessed key. The `unitdp` query is another part of the read's meaning: this request asks Xero for four-decimal unit prices.

![Annotated YAML connector sketch showing authentication, endpoint selection, pagination, and the watermark configuration](../../../assets/posts/data-integration/flow.png)

## How does incremental sync use watermarks safely?

A watermark records how far a source was successfully read. Undercroft stores it separately from the Postgres loading cursor: fetching from a provider and projecting saved data into Postgres are different operations.

Three details prevent a partial run from becoming a permanent gap:

1. **Advance after a completed entity read.** A failure midway through an entity leaves its previous watermark available for the next run. Taking the greatest timestamp from records already loaded could skip older records on unread pages.
2. **Keep the source's value and its format together.** A format change invalidates the saved watermark. Xero's Microsoft JSON date is stored as source text, but sent as RFC 3339 UTC rounded down to the second because its filter reads a different representation.
3. **Associate the watermark with the request.** Changes to the endpoint query or selected properties can invalidate it. A changed request needs a whole read to obtain its new representation of older records, subject to the whole-read budget.

The schema supports `header`, `query-param`, and `client-filter` strategies. The first two ask the provider to filter. HubSpot's `client-filter` still walks every page and skips landing records older than the watermark. It saves downstream work, not API bandwidth, and never stops merely because one old record appeared.

Incremental sync also depends on what the source considers a change. Xero's change filter cannot expose every edit. Undercroft therefore supports a separate, opt-in re-sync schedule for eligible connections, which reads lists whole again during sync runs. Re-sync is paused by default; leaving it off can leave edits invisible to that filter stale.

## How should a data pipeline handle rate limits and failures?

Pacing reduces request pressure before throttling happens; retries handle selected responses after it happens. Both shipped YAML specs configure retries for `429`, `500`, `502`, `503`, and `504`, and respect `Retry-After`. The Xero spec sets a minimum request interval of 1,100 milliseconds and caps the wait accepted from that header.

Whole reads have a separate budget. The current Xero spec sets a 1,000-request day and allows whole reads to spend 800, leaving a reserve of 200. These are the repository's configured values. The worker uses Xero's remaining-budget header when available, so the decision can account for requests spent outside the current run.

When that budget stops a whole read, the journal says it paused or is waiting. A partial whole read saves no new watermark, and a later whole read starts from the beginning. The run may close successfully with a warning; its status alone does not establish that every list completed.

Actual connector failures raise `ConnectorError` with the number of records seen. They are not converted into an empty stream. An unreadable record ID is an error, while an unreadable incremental timestamp is not treated as proof that the record is old: the record can land without advancing the watermark.

Empty results need context too. Specs can allow legitimately empty entities. The empty-read guard is relaxed for an incremental read that actually sends a watermark, allowing “nothing changed” without pretending a first read succeeded. Missing source permissions are explicitly reported as lists not granted, rather than silently presented as empty business data.

## How do you schedule syncs and check what happened?

Connections support hourly, every-six-hours, daily, and paused presets, plus custom five-field cron expressions. Custom schedules use `Asia/Singapore`, and the scheduler checks due work on a five-minute tick. Expressions whose fires can fall closer together than that tick are refused; this is scheduled ingestion, not a promise of instantaneous streaming.

For an operational check, read the run journal alongside the counts. Undercroft stores structured run events in `ops.run_event`, so evidence remains available after the browser closes. The journal uses defined events, counts, and opaque IDs, with wording supplied in the interface's language; it is not a copy of unrestricted worker logs.

Before depending on a new source, inspect its first whole read, a later incremental read, and any permission or budget warnings. Then check that the dbt model answers the business question with the data actually collected.

## Which integration guide should you read for your source?

Use the source guides for the details a shared connector overview cannot settle:

- [Xero integration into Postgres](/en/xero-integration-postgres/) covers the accounting source behind the YAML example.
- [HubSpot integration into Postgres](/en/hubspot-integration-postgres/) covers CRM objects and relationships.
- [Gmail integration from email to a database](/en/gmail-integration-email-to-database/) addresses the email collection path.
- [Google Drive integration for OCR and search](/en/google-drive-integration-ocr-search/) addresses the document path.

Gmail and Google Drive use first-party code collectors because their content includes bytes that the JSON connector runtime does not represent. They reuse pacing, retries, and the same lake write path. Other source behavior outside the declarative contract can use an external caller of the REST lake API. YAML is useful within its supported contract; it does not eliminate every integration-specific implementation.

## FAQ

### Is data integration the same as ETL?

No. Data integration is the broader goal of using separate sources together; ETL describes extracting, transforming, and loading data in that order. Undercroft stores raw data before user-authored dbt transformations, following an ELT approach.

### Can I build an API connector without writing code?

You can describe a supported REST read in YAML rather than write its request loop. Product registration and release work still applies, and behavior outside the schema needs another ingestion path.

### Does incremental sync always reduce API calls?

No: a client-side filter still reads the source's pages. A server-side header or query filter can reduce the returned data, subject to that endpoint's capabilities.

### Does a successful run mean every source record is current?

No: inspect the journal for lists not granted, budget pauses, and other limits. A source's change filter can also miss edits, so consider the connection's re-sync setting before treating its data as current.
