---
title: Runbook Google Ingestion Setup
type: source
date: 2026-09-23
tags: []
source: docs/runbook/google-ingestion-setup.md
source_path: docs/runbook/google-ingestion-setup.md
source_hash: 79898d8e156518ae21f89608a2d498bed69407fe533950792dab4770a45d693e
ingested: 2026-09-23
---

# Runbook Google Ingestion Setup

Standing up the per-tenant Gmail and Drive consent from nothing, with a check after each step. This is not sign-in: signing in asks Google for `openid email profile` ([[Runbook Sign-In Setup]]); this asks for a customer's mailbox or documents, per tenant, and its credentials are sealed into `app.connection_secret` by the worker ([[ADR 0016 The Worker Seals the Control Plane Consents]]). Two different Google clients on purpose, because one client carrying both scope lists is one misconfiguration away from handing over a mailbox as a side effect of signing in.

Verification is the long pole. `gmail.readonly` is a Google restricted scope: until the client is verified the app is capped at 100 test users behind an interstitial, and restricted scopes require a CASA security assessment repeated every twelve months. `drive.file` is not restricted, which is why Drive is scoped through Google's Picker rather than a folder listing of our own. The whole surface is gated on `UNDERCROFT_GOOGLE_INGEST_CLIENT_ID`; unset, every Google source reads "not connected", so the feature can be deployed while verification runs.

The steps: create the ingest client with the redirect URI `<UNDERCROFT_PUBLIC_URL>/oauth/google/callback`, set the ingest variables and the Picker's public values, connect a source from the customer's Sources leaf, choose a scope (labels for Gmail, files or folders for Drive) and save, then confirm in `psql` that `ops.connection` holds an opaque account id and never an address, that exactly one sealed credential exists and the control plane cannot open it, and that the mailbox address lives in `app.connection_detail` where BI has no USAGE.

Running an ingest is a plate, not a `curl`: an admin presses Run now on the source's card, the card shows Running and polls, the mark flips with the count landed and the next due time, and the Journal division lists the run with per-entity counts and any refused record with its reason; a second Run now while one is in progress is refused with the running run's id. Run it twice: every document should report `unchanged`, the idempotency guard. Disconnect must revoke the grant at Google too.

Several accounts: "Add another account" on the card opens Google's account chooser and gives the chosen account a connection of its own, with its own mark, scope, schedule, last run and actions ([[ADR 0043 A Second Mailbox Is a Second Source]]). The first account keeps the source `gmail`/`drive`; each further one is `gmail.<account key>`. A dbt model filtering `source = 'gmail'` sees only the first mailbox; filter `source LIKE 'gmail.%'` too, or use the shipped `{{ gmail_letters() }}` macro, which folds cross-mailbox copies on the RFC 5322 Message-ID. Reconnect is pinned to its account: completing it as another Google account is refused as `reason=account-mismatch`; `reason=account-unidentified` means Google named no account, or the first account never recorded one.
