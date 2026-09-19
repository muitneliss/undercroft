---
title: Runbook Google Ingestion Setup
type: source
date: 2026-09-19
tags: []
source: docs/runbook/google-ingestion-setup.md
source_path: docs/runbook/google-ingestion-setup.md
source_hash: 4e64c6e22d1e658c936b9b601307c21f848543a53625d569da64dbb05030945e
ingested: 2026-09-19
---

# Runbook Google Ingestion Setup

Standing up the per-tenant Gmail and Drive consent from nothing, with a check after each step. This is not sign-in: signing in asks Google for `openid email profile` ([[Runbook Sign-In Setup]]); this asks for a customer's mailbox or documents, per tenant, and its credentials are sealed into `app.connection_secret` by the worker ([[ADR 0016 The Worker Seals the Control Plane Consents]]). Two different Google clients on purpose, because one client carrying both scope lists is one misconfiguration away from handing over a mailbox as a side effect of signing in.

Verification is the long pole. `gmail.readonly` is a Google restricted scope: until the client is verified the app is capped at 100 test users behind an interstitial, and restricted scopes require a CASA security assessment repeated every twelve months. `drive.file` is not restricted, which is why Drive is scoped through Google's Picker rather than a folder listing of our own. The whole surface is gated on `UNDERCROFT_GOOGLE_INGEST_CLIENT_ID`; unset, every Google source reads "not connected", so the feature can be deployed while verification runs.

The steps: create the ingest client with the redirect URI `<UNDERCROFT_PUBLIC_URL>/oauth/google/callback`, set the ingest variables and the Picker's public values, connect a source from the customer's Sources leaf, choose a scope (labels for Gmail, files or folders for Drive) and save, then confirm in `psql` that `ops.connection` holds an opaque account id and never an address, that exactly one sealed credential exists and the control plane cannot open it, and that the mailbox address lives in `app.connection_detail` where BI has no USAGE.

Running an ingest is a plate, not a `curl`: an admin presses Run now on the source's card, the card shows Running and polls, the mark flips with the count landed and the next due time, and the Journal division lists the run with per-entity counts and any refused record with its reason; a second Run now while one is in progress is refused with the running run's id. The worker's HTTP verb is on the compose network only. Run it twice: every document should report `unchanged` and the lake gain no new version, which is the idempotency guard. Finally, Disconnect must revoke the grant at Google too, and the card says when it could not.
