---
title: ADR 0079 Xero Reads Bank Transactions Transfers And Manual Journals
type: source
date: 2026-09-28
tags: []
source: docs/adr/0079-xero-reads-bank-transactions-transfers-and-manual-journals.md
source_path: docs/adr/0079-xero-reads-bank-transactions-transfers-and-manual-journals.md
source_hash: 5a45093bde119c97db137d1839e8d2b3c16a36cfa99fd56969fdc494bf4fbc2b
ingested: 2026-09-28
---

# ADR 0079 Xero Reads Bank Transactions Transfers And Manual Journals

# ADR 0079 Xero reads bank transactions, bank transfers and manual journals

Status: Accepted, 2026-09-28. Issue 308. Extends [[ADR 0069 Xero Reads Every List Its Granular Scopes Reach]] and [[ADR 0073 A List Its Grant Cannot Read Is Named Not Failed]]; both stand unchanged.

## Context

The consent asked for invoices, payments, contacts and settings. None reaches `/BankTransactions`, `/BankTransfers` or `/ManualJournals`, so money that moves without an invoice (spend/receive money, transfers between the organisation's own accounts, hand-written period-end journals) never reached the lake, and nothing said so. Xero's OpenAPI document still puts all three paths under the broad `accounting.transactions(.read)`, which Xero grants to no app created on or after 2 March 2026; Xero's granular scope table is the only source for the split: bank transactions and bank transfers under `accounting.banktransactions`, manual journals under `accounting.manualjournals`. ADR 0073 bounds the cost if that table is wrong again (as it was for items): an ungranted list is named, never requested.

## Decision

* The consent asks for `accounting.banktransactions.read` and `accounting.manualjournals.read` (spec `auth.scopes` and `oauthProviders.ts`).
* `bank_transactions`: paged, `pageSize`, `unitdp=4` (issue 280's rounding), incremental on `If-Modified-Since`.
* `bank_transfers`: unpaged, read whole every run with `includeDeleted=true`. The record carries only `CreatedDateUTC`, so no watermark can see a later change, and Xero hides DELETED transfers unless asked; without it a deleted transfer would stay in the lake as AUTHORISED.
* `manual_journals`: paged, `pageSize`, incremental on `If-Modified-Since`.
* All three `failOnEmpty: false`.

## Consequences

Existing connections keep reading their other lists; each run names the three new lists as not granted, and the card stays connected with a Reconnect naming the two scopes ([[ADR 0074 The Card Judges A Grant By The Lists It Reads]]). After a reconnect a default run reads twenty lists. If live Xero refuses a list under the named scope, the repair is to move its `readScope`.

## Rejected

Asking for the broad `accounting.transactions.read` (refused for new apps); reading `/BankTransfers` incrementally (no change time, deletions hidden); reading `/Journals` too (the general ledger, a different question, under `accounting.journals.read`); adding the two scopes in separate changes (one reconnect for both).
