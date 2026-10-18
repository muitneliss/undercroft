---
title: ADR 0144 A Refresh Token's Stated End Is the Grant's End
type: source
date: 2026-10-18
tags: []
source: docs/adr/0144-a-refresh-token-s-stated-end-is-the-grant-s-end.md
source_path: docs/adr/0144-a-refresh-token-s-stated-end-is-the-grant-s-end.md
source_hash: 85e294518edc840151ddc40fe89108b5b6d79b7fcfcc2f0cc45061ed92ed2f50
ingested: 2026-10-18
---

# ADR 0144 A Refresh Token's Stated End Is the Grant's End

A Google refresh token's stated end becomes the grant's end, so the week-ahead "access is about to expire" notice of [[ADR 0030: An email is a leaf of the book, posted]] fires for Google as it does for Xero. It was written after one customer's Gmail and Drive connections, on two accounts, were each refused by Google about seven days after every reconsent, with no warning before the card read "Cần cấp lại quyền" (needs reconnecting).

**Cause.** A Google project whose OAuth consent screen is still in **Testing** gets refresh tokens that die seven days after issue. Google says so in the token response as `refresh_token_expires_in`, and sends the same field for a time-based grant. Nothing read it, and `grantExpiry.ts` claimed Google announces no end, so `app.connection_secret.grant_expires_at` stayed `NULL` for every Google grant.

**Decision.** The control plane's code exchange (`tokenExchange.ts`) reads `refresh_token_expires_in` and sends it to the worker as the credential's optional `refreshExpiresAt` (`CredentialInput`). An absent field is `null`, never "it never dies". `grantExpiryFor` answers the stated instant first, Xero's sixty-day rule second, `null` otherwise. A reconsent that states nothing writes `null`, so a project published since the last consent stops being warned about. On refresh, `grantExpiryAfterRefresh` answers `"unchanged"` for a provider with no rule that handed back the same refresh token (Google does not rotate). `writeCredential` then keeps the stored end and its `warned_at`, rather than wiping the date within the hour. Xero rotates, and its rule still moves the end sixty days out.

A Testing project is therefore warned about straight after each consent, because seven days is inside the warning's week. The remedy is the operator's: publish the consent screen ([[Runbook Google Ingestion Setup]]).

**Rejected.** Assuming seven days for every Google grant (a guess about a console setting, and false for a published project). Reading the field on every refresh as well (stated once, beside a token never rotated). Probing the project's publishing status (no API a deployment's client can call answers it).
