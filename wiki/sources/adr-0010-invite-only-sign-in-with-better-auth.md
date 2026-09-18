---
title: ADR 0010 Invite-Only Sign-In with Better Auth
type: source
date: 2026-09-18
tags: []
source: docs/adr/0010-invite-only-sign-in-with-better-auth.md
source_path: docs/adr/0010-invite-only-sign-in-with-better-auth.md
source_hash: 35ea580a788634e82e287a630435dda304071d36c8fd57df81442b2062b8008b
ingested: 2026-09-18
---

# ADR 0010 Invite-Only Sign-In with Better Auth

> **Numbering note.** Two accepted ADRs share the number 0010. This is the sign-in one;
> the other is [[ADR 0010 The Mark Is One Ink]].

## Decision

The control plane authenticates people with **Better Auth 1.7.5**: Google, plus a one-time
code emailed to an address. There are no passwords. Sign-in is **invite-only** — an address
must match a live row in `app.invitation` or an existing `app.app_user`.

Better Auth owns four tables of its own (`app.auth_user`, `app.auth_session`,
`app.auth_account`, `app.auth_verification`) created by `packages/db/sql/060_auth.sql`.
`app.app_user` remains the platform's user identity. **The two identities are joined on
email address.**

This closes the follow-up recorded under accepted risks in
[[ADR 0008 Deploy on Release from CI]]; that ADR is unchanged and its risk stands as
recorded history.

## Why a library, in a repo that writes its own SQL

The parts of sign-in that are easy to get subtly wrong — OAuth `state` and PKCE, cookie
signing, OTP attempt limits and expiry, account linking — are the parts where being subtly
wrong is a silent authentication bypass rather than a failing test. The crypto primitives
were already available; the primitives are not the hard part, the protocol state machine is.

Better Auth's sessions are database-backed by default, the one property this codebase could
not compromise on: a stateless token is unacceptable because "the buttons behind this cookie
mint OAuth tokens into a customer's accounting system".

## Invite-only is enforced three times

One gate that fails open is an open control plane, so there are three, in different places:

1. **`user.validateUserInfo`** refuses an uninvited identity before creation, and again on
   every returning *Google* sign-in — so withdrawing access takes effect at the next sign-in.
   Better Auth fails this hook closed.
2. **`sendVerificationOTP`** will not mail a code to an address that could not use it.
   Without this, anyone could make the platform email an arbitrary stranger on demand.
3. **`resolveCaller`** resolves no `Context.user` without an `app.app_user` row, so even a
   validly signed session for a removed account arrives unauthenticated. This covers a
   returning sign-in *by code*, which `validateUserInfo` does not see.

### `disableSignUp` is deliberately NOT set

It reads like the obvious way to express invite-only and is the wrong tool, quietly: Better
Auth's OTP send endpoint returns success **without mailing anything** to an address with no
account yet — which is every invited person's first sign-in.

### The sign-in form does not say who has access

Requesting a code for an uninvited address returns success and sends nothing. Answering
honestly would turn the form into an oracle for which addresses can sign in.

## The cost of joining on email

* **A changed provider address is a new identity** — the outcome is a *refused sign-in*
  rather than a silent identity swap, which is the safe direction rather than a fix.
* **An invitation must be accepted from the address it was sent to.**
* **`+` aliases are different people.** Accepted; canonicalisation would surprise someone.
* **Case had to be pinned in the database.** `060_auth.sql` adds `UNIQUE (lower(email))`,
  closing a latent duplicate-identity bug that predates this work.

## What changed about sessions

* `session.cookieCache` is **off and must stay off** — it would answer from a signed cookie
  without reading the database, so a revoked session would keep working.
* `session.signOut` **deletes** the session row rather than flagging it.
* Resolving a caller is now two queries rather than one.
* **`app.session` is superseded and unread**, left in place because dropping a table is a
  separate destructive migration.

## Consequences

* **Migrations can finally be applied.** `bun run migrate` exists as its own deploy step
  rather than a call at service boot — two replicas racing the same DDL is a failure that
  surfaces under the worst possible load.
* **A forgotten grant is now caught.** `060_auth.sql` carries its own grants and a test
  enumerates the whole `app` schema rather than naming tables.
* **Login tokens are encrypted at rest.** They are identity scopes only; Gmail and Drive
  access remains a separate per-tenant consent, so signing in never hands over a mailbox.
* **Invitations are managed in the product**, not in SQL. The first admin comes from
  `bun run invite`, a second caller of the same service.
* **A refused sign-in is recorded.** `auth.refused` lands in `ops.audit_log`; the refusal
  stays silent to the caller, so the trail is the only place the truth is written down.
* **No invitation token is issued** — Google and a one-time code already prove the person
  controls the address.
* **The offline gate proves the whole ring** over a real loopback `Bun.serve`, with Better
  Auth on its `memoryAdapter` and the platform tables in PGlite.
* **A schema mismatch refuses every request — it is not a warning.** With the tables absent
  the control plane logs `sign_in_configured` and then answers 500 to every `/api/auth/*`
  request. Hence `db-migrate`, the one-shot compose service that applies the schema first.
* **The real `pg` path is exercised on deploy, not in the gate.**

## Related

The step-by-step for standing this up is [[Runbook Sign-In Setup]]; the privileges that
keep a signed-in session away from raw payloads are [[ADR 0005 The Role and Grant Model]].
