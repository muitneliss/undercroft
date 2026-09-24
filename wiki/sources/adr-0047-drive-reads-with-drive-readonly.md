---
title: 'ADR 0047: Drive reads with drive.readonly'
type: source
date: 2026-09-24
tags: []
source: docs/adr/0047-drive-reads-with-drive-readonly.md
source_path: docs/adr/0047-drive-reads-with-drive-readonly.md
source_hash: da4d8a4087910cc21eed54d7e093bab80c410bd8ee3cc2ea1c101459582ae1d8
ingested: 2026-09-24
---

# ADR 0047: Drive reads with drive.readonly

Accepted 2026-09-24. Supersedes the "Drive asks for `drive.file`" decision of [[ADR 0016 The Worker Seals the Control Plane Consents]] and the option it rejected, and the "Move to `drive.readonly`" rejection in ADR 0031, answering the question 0031 left open. Both ADRs otherwise stand: the worker seals, the control plane consents, two Google clients, and `recurse` as the admin's recorded choice.

**Context.** Issue #178: a Drive run on one picked folder closed `status=ok` with `landed: 0` and a single `no-matching-files-in-folder` refusal, against a folder holding files one to five levels down. Under `drive.file`, picking a folder in Google's Picker does not grant the files already inside it. Google does not refuse the listing; it answers 200 with an empty page, so "empty folder" and "blind grant" are indistinguishable (Uppy found the same, transloadit/uppy#6385). The competing hypothesis, that `recurse` descends only one level, is false: `listMatchingIn` queues every sub-folder, and the suite now lands a file five levels down.

**Decision.** Drive's ingestion consent asks for `drive.readonly`. The read scope each Google source needs lives in one table, `GOOGLE_READ_SCOPES` in `@undercroft/contracts`, used by both the consent (`oauthProviders.ts`) and the worker. A grant recorded without its source's read scope is refused before Google is asked: `requireReadGrant` (`apps/worker/src/services/google/grant.ts`) raises `GrantTooNarrow`, naming the missing scope and the reconnect, so a run fails loudly instead of closing green, and a browse answers `scope-insufficient`. An empty recorded scope is not refused (no evidence). The card already shows old `drive.file` grants as `needs_reconnect` through `grantCovers`. Drive can now be browsed: `connections.browseScope` lists every folder the grant can see with its path (shared drives included) and the distinct file types present, bounded by `DRIVE_BROWSE_BOUNDS`, with any cut or `incompleteSearch` list named in `partial`. The browser Picker stays for choosing, and its own token stays `drive.file`.

**Why.** `drive.file` cannot read a picked folder at all. The CASA argument no longer holds: the assessment is per OAuth client, and the same ingest client already carries the restricted `gmail.readonly`.

**Cost accepted.** "No other folder is read" is now kept by the collector's own `'<picked id>' in parents` query, the recorded `recurse` and reading a picked file by its id, not by Google. Every existing Drive connection must reconnect; until then its runs fail with the reconnect reason.

**Rejected.** Keeping `drive.file`; `drive.metadata.readonly` (also restricted, cannot read bytes); Picker multi-file selection (new files never readable); detecting a blind grant from an empty listing (a guess).

**Consequences.** `BrowseScopeRequest.kind` gains `folders`; item `kind` gains `folder` and `file-type`, and a folder item pastes into a Drive scope's `files`; `BrowseScopeResponse.partial` defaults to empty and the control plane parses rather than casts the worker's answer. A refused browse carries `details` (source, listing, reason, remedy) through the control plane's `refusal` helper to the CLI's `error.details`. `error.scopeInsufficient` names the source. See [[Runbook Google Ingestion Setup]].
