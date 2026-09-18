---
title: Runbook Google Ingestion Setup
type: source
date: 2026-09-18
tags: []
source: docs/runbook/google-ingestion-setup.md
source_path: docs/runbook/google-ingestion-setup.md
source_hash: c5a405092d934949e5f68f8ec9d24c4990f3d43eee58c2aadf666e0bdde41011
ingested: 2026-09-18
---

# Runbook Google Ingestion Setup

# Runbook Google Ingestion Setup

Standing up the per-tenant Gmail and Drive consent from nothing, with a check after each step.

**This is not sign-in.** Signing in asks Google for `openid email profile` and is covered by the
sign-in runbook. This asks for a customer's mailbox or documents, per tenant, and its credentials
are sealed into `app.connection_secret` by the worker. They use **two different Google clients on
purpose**: one client carrying both scope lists is one misconfiguration away from handing over a
mailbox as a side effect of signing in.

## Verification is the long pole

`gmail.readonly` is a Google **restricted** scope. Until the client is verified the app is capped
at 100 test users behind an unverified-app interstitial, and restricted scopes additionally require
a **CASA security assessment repeated every twelve months** — weeks of calendar time and a real
invoice. No code change avoids it.

`drive.file`, which Drive uses here, is **not** restricted: basic verification only, no CASA, no
annual renewal. That is why Drive is scoped through Google's Picker rather than a folder listing
of our own.

The whole surface is gated on `UNDERCROFT_GOOGLE_INGEST_CLIENT_ID`. Unset, the feature is dormant —
every Google source reads "not connected" and no button leads anywhere — so it can be deployed
while verification runs in parallel.

## The steps

1. **Create the ingestion OAuth client** (Web application), named so it cannot be confused with the
   sign-in client. Redirect URI path is fixed: `/oauth/google/callback`, one line per origin.
2. **Enable the APIs**: Gmail API, Google Drive API, Google Picker API.
3. **Add the scopes** to the consent screen: `gmail.readonly` (restricted, CASA),
   `drive.file` (non-sensitive), plus `openid` and `email` so the callback learns which account
   consented.
4. **Create a Picker API key**, restricted to the Picker API and your origins, and note the Cloud
   project number — the Picker needs it as its app id. An API key and a client id are public values;
   the client secret is not one of them and never reaches the browser.
5. **Set the environment**: `UNDERCROFT_GOOGLE_INGEST_CLIENT_ID/_SECRET` on both the control plane
   (which runs the consent) and the worker (which refreshes afterwards);
   `UNDERCROFT_GOOGLE_PICKER_API_KEY` and `UNDERCROFT_GOOGLE_PROJECT_NUMBER` on the control plane
   only. `UNDERCROFT_WORKER_URL` and `UNDERCROFT_TRIGGER_TOKEN` must also be set or the consent
   cannot be sealed.

## Checking it worked

Walk the flow, confirming the authorize URL carries `access_type=offline` and `prompt=consent` —
without both, Google issues no refresh token and the connection dies at the first expiry with
nothing to renew it. Then in `psql`: `ops.connection` should show `connected` with an opaque numeric
`sub` and **not** an email address; `app.connection_secret` should hold exactly one row the control
plane cannot open; `app.connection_detail` holds the mailbox address, where BI has no USAGE;
`ops.audit_log` records who did what.

Trigger an ingest through `/v1/runs/ingest`, then check `raw.records` and `raw.documents`. The
catalogue's `metadata` must contain no filename, subject or address — that table is granted to dbt.
Run it a second time immediately: every document should report `unchanged` and the lake should gain
no new version. That is the idempotency guard, and the one that silently costs disk if wrong.

Disconnect, then confirm at `myaccount.google.com/permissions` that the grant is gone there too, not
only from our table.

## Common failures

* Connect button does nothing → `UNDERCROFT_GOOGLE_INGEST_CLIENT_ID` unset; the placeholder URL.
* `redirect_uri_mismatch` → `UNDERCROFT_PUBLIC_URL` is not the origin the browser uses.
* `reason=not-admin` → the session is not an admin of that tenant; starting a flow is not a standing
  authorisation and is re-checked at the callback.
* `reason=bad-state` → the consent took over 15 minutes, or the link was opened twice. Refused
  identically by design.
* `reason=worker-refused` → the worker is unreachable, or the trigger token differs between services.
* "has no recorded scope" → connected but nobody chose what to read. Deliberate: an absent scope is
  never defaulted to the whole mailbox.

See also: ADR 0016 (the worker seals, the control plane consents), ADR 0015 (a first-party collector
for byte sources), the sign-in setup runbook.
