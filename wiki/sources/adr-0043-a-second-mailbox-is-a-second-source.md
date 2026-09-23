---
title: ADR 0043 A Second Mailbox Is a Second Source
type: source
date: 2026-09-23
tags: []
source: docs/adr/0043-a-second-mailbox-is-a-second-source.md
source_path: docs/adr/0043-a-second-mailbox-is-a-second-source.md
source_hash: a201a037d9f4bbd8e24e0e65b4005e35ae345d6556801bde99ab0505496951bf
ingested: 2026-09-23
---

# ADR 0043 A Second Mailbox Is a Second Source

A tenant may connect several Gmail mailboxes and several Drive accounts. Before this, every connection was keyed `(tenant_id, source)`, so consenting a second mailbox replaced the first: its credential, address, labels and account id. Nothing checked that a reconnect was the same Google account, so "Reconnect" completed by another account silently filed that mailbox's mail under the first one's stream. Gmail's `message.id` and `threadId` are per-mailbox, so the same letter in two mailboxes carries unrelated ids; issue #125 measured 18% duplicate rows.

The decision refines `source` rather than widening the key. The first account of a kind keeps the bare source (`gmail`); each further one is `<kind>.<first 12 hex of sha256(sub)>`, e.g. `gmail.3fa9c1d2e0ab`. Only `gmail` and `drive` may carry a key (`MULTI_ACCOUNT_KINDS` in `@undercroft/contracts/sources`, a browser-safe entry point with `parseSourceInstance` and `sourceKind`). Because everything per-account was already per-source, each account gets its own sealed credential and refresh lock, run guard, last run, card status, cadence, due-list entry, raw rows and lake keys by construction. The key is derived, not allocated, so re-adding a held account is a reconnect and no slot counter is raced over. Kind lookups (`parseScope`, `needsScope`, `isScopedSource`, `providerOf`, refreshers, the Google path) read the kind; `startIngest` refuses a string that is not a source instance.

The guard is in SQL: `upsertConnection` only replaces a recorded account id with itself (`ON CONFLICT … DO UPDATE … WHERE … RETURNING`); a mismatch seals nothing and the worker answers 412 `account_mismatch`. An empty incoming id erases nothing, which also fixes Xero reconnects blanking the chosen organisation. `app.oauth_handshake.adds_account` (migration 260) tells "Add another account" from "Reconnect". `resolveAccount` pins a reconnect to its recorded account, resolves an add by identity (held → reconnect; no first account → bare; else derived), refuses a consent with no identity as `account-unidentified`, and retries a lost add race once. An add asks Google for `prompt=consent select_account`; a reconnect sends `login_hint`.

Deduplication is a projection: the shipped dbt macro `gmail_letters()` folds per-mailbox copies into one row per letter on the RFC 5322 `Message-ID` (case-insensitive header lookup), keeping `copies`, `sources`, `message_ids`, `thread_ids`, `documents_landed` (max across copies) and `headers_conflict`. A letter with no Message-ID stands alone. A model filtering `source = 'gmail'` sees only the first mailbox. Out of scope: a per-run identity probe, cross-mailbox extraction dedupe ([[ADR 0040 The Catalogue Does Not Inherit the Lake's Deduplication]]), and per-account ingest keys. Rejected: an `account` column on every table (re-keys the partitioned `raw.records` and the lake), allocated slots, the raw `sub` as the suffix, and deduping in the collector.
