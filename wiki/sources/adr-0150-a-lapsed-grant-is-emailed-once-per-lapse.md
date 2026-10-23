---
title: ADR 0150 A Lapsed Grant Is Emailed Once Per Lapse
type: source
date: 2026-10-23
tags: []
source: docs/adr/0150-a-lapsed-grant-is-emailed-once-per-lapse.md
source_path: docs/adr/0150-a-lapsed-grant-is-emailed-once-per-lapse.md
source_hash: 394b58f2057a2009c5b4568ed06d952e849b64c0164ef837e6aac79f753ea09b
ingested: 2026-10-23
---

# ADR 0150 A Lapsed Grant Is Emailed Once Per Lapse

Touches [[ADR 0030: An email is a leaf of the book, posted]], whose family of email leaves gains one, and [[ADR 0110 A Tenant Can Be Deactivated]], under which a lapse at a deactivated customer is claimed and withheld like every other notice. [[ADR 0144 A Refresh Token's Stated End Is the Grant's End]] warns before a grant ends; this one tells after a provider refused it.

**Why.** When a provider refuses a grant (Google's `invalid_grant`, a Xero refresh token gone unused) the worker marks `ops.connection.status = 'expired'` and the card asks for a reconnect, but an admin who does not open the card is never told. What they got instead was the failed-run email of the run that found the lapse, whose correction slip carries the provider's raw English and whose lead never says a reconnect is needed. A lapse found outside a run, by a scope browse, sent nothing at all.

**Decision.** The control plane's alert tick emails a tenant's admins when a grant has lapsed, once per lapse. Lapsed means `status = 'expired'`, said once as the `LAPSED` SQL fragment in `packages/db/src/repos/connections.ts`; `error` is left out although the card shows it with the same reconnect, because nothing writes it and a provider fault does not earn the words "lapsed or withdrawn". The claim is `claimLapsedGrants`, one UPDATE that marks and returns `app.connection_secret.lapse_told_at` (`640_lapse_notice.sql`) -- on the secret's table because BI reads `ops.connection`. `writeCredential` clears the marker when it writes a credential for a connection that is not lapsed, which is what a reconnect is (`storeCredential` records `connected` before it seals); a refresh that succeeds while the connection still reads `expired` keeps it, or the next tick would re-tell a lapse still standing. Lapses standing when this shipped are told on the first tick, with no backfill. A failed run whose connection is lapsed gets no failed-run email -- the lapse notice is that email -- but stays claimed `sent`, so the operators' Lark card and its recovery still post; `resolveToken` writes `expired` before the run closes failed. The notice is email-only like the grant and key warnings, not claimed without email, sent through `recipientsFor`, worded as the card is (lapsed or withdrawn, nothing lost, reconnecting resumes from the last sync), naming the mailbox where a source may hold several, and linking to the customer's sources page.

**Consequences.** A lapse found by a browse after a run failed for another reason is told twice, as two discoveries. A lapse found by a browse reaches the operators only through the card, not Lark. Recipients stay the admins, a role; whether notices should follow `sources:manage` is a separate change.

**Rejected.** Keeping the failed-run email beside the lapse email (one cause, two emails, one in raw English); marking the lapse on BI-readable `ops.connection`; clearing the marker on every credential write (a refresh while still expired would re-send); re-arming in `upsertConnection` (the ops writer would write the secret's table as a side effect); a trigger on the status change (a hidden write); marking standing lapses as already told (a claim of a notice that never went out).
