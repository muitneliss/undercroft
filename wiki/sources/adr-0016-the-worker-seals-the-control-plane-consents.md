---
title: ADR 0016 The Worker Seals the Control Plane Consents
type: source
date: 2026-09-18
tags: []
source: docs/adr/0016-the-worker-seals-the-control-plane-consents.md
source_path: docs/adr/0016-the-worker-seals-the-control-plane-consents.md
source_hash: adc57b455d6a6164e41a25e410ab79aad8a9c4051252fdc5c987e3f0f9fe2a18
ingested: 2026-09-18
---

# ADR 0016 The Worker Seals the Control Plane Consents

# ADR 0016 The Worker Seals the Control Plane Consents

## Decision

**A per-tenant Google consent is run by the control plane and sealed by the worker.**

The control plane serves `GET /oauth/google/callback`, exchanges the authorization code, and
POSTs the token bundle to a worker verb on the trigger-token allowlist. The worker holds
`UNDERCROFT_SECRET_KEY` and writes `app.connection_secret`. The control plane never has the key,
so it can never read a stored credential back.

Ingestion uses a **second Google OAuth client**, separate from sign-in's:
`UNDERCROFT_GOOGLE_INGEST_CLIENT_ID` / `_SECRET`. Drive asks for **`drive.file`**, not
`drive.readonly`.

## The constraint that forces the split

Google's redirect must land on a public origin: the control plane has a domain, the worker
deliberately does not. Sealing must happen where the master key is: the worker has it, the control
plane deliberately does not. Both are true at once, so the flow crosses one internal hop.

## Options rejected

* **Give the control plane the master key.** One fewer hop, no new verb. Rejected: it puts the key
  in the internet-facing process and breaks the invariant ADR 0005 rests on. That process would
  gain the ability to decrypt every stored credential for every tenant, permanently, to save one
  internal POST.
* **Expose the worker publicly, or proxy the callback to it.** Puts an internet-reachable route on
  the process holding the key. Strictly worse.
* **One Google client for sign-in and ingestion.** Fewer secrets, but the failure it permits is
  silent and total: one wrong scope list on the login path and signing in hands over a mailbox.
  Two clients make that impossible rather than unlikely.
* **`drive.readonly` with our own `q=` filter.** Simpler UI. Rejected twice over: it is a Google
  *restricted* scope, pulling the product into an annual CASA security assessment alongside Gmail;
  and the shipped promise "No other folder is read" would be enforced only by our own query, where
  `drive.file` has Google enforce it.

## Accepted residual risk

**The plaintext token bundle crosses the internal Docker network in a POST body.** Stated here
rather than discovered later. The trust assumption already exists — the trigger token crosses the
same network, and a reader of that traffic can already start any allowlisted verb. What the split
still buys is that compromising the *internet-facing* process yields no stored credential for any
tenant, because it holds nothing that can open one.

## Consequences

* **`app.oauth_handshake` holds the in-flight state, not a cookie.** There is no cookie middleware
  in the control plane; Better Auth owns every cookie. A row gives a server-enforced TTL, single-use
  consumption as one `DELETE ... RETURNING` rather than a read-then-write a replay can race, and a
  record of which admin began the flow. The state is stored as a digest, like
  `app.invitation.token_sha256`; the PKCE verifier is not hashed because it goes back to Google
  verbatim, which is the second reason the table sits in `app`.
* **Order in the callback is the security argument.** State first (consuming it makes a replay
  impossible), then the admin check (re-asked at the moment of use, because minutes pass and a role
  can be withdrawn in them), and only then is the code spent.
* **Unknown, expired and already-used states are refused identically**, so the callback is not an
  oracle for whether a guessed state ever existed.
* **Three grants `040_grants.sql` never made are now load-bearing**, added in
  `070_google_ingestion.sql`: the worker may INSERT and UPDATE `ops.connection` and INSERT
  `app.connection_secret`. None had ever fired, because `accessToken` had no caller passing a
  refresher.
* **Gmail still needs CASA.** No non-restricted Gmail scope reaches attachments. The surface is
  gated on `UNDERCROFT_GOOGLE_INGEST_CLIENT_ID`: unset, `startOAuth` returns the placeholder it
  always has and every Google source reads "not connected" — no dead buttons while verification is
  pending.

See also: ADR 0005 (the role and grant model), ADR 0010 (invite-only sign-in with Better Auth),
ADR 0015 (a first-party collector for byte sources), the Google ingestion setup runbook.
