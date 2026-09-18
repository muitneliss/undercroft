---
title: Runbook Sign-In Setup
type: source
date: 2026-09-18
tags: []
source: docs/runbook/sign-in-setup.md
source_path: docs/runbook/sign-in-setup.md
source_hash: 1c049808bf8ce10292ba7aa05eb692c3373691bb30a91d1e6fb3f0acbea97786
ingested: 2026-09-18
---

# Runbook Sign-In Setup

A step-by-step for standing up sign-in from nothing, with a way to check each step actually
worked. The decisions behind it are in
[[ADR 0010 Invite-Only Sign-In with Better Auth]]; the production-specific parts are in
[[Runbook Deployment]].

Sign-in is **invite-only**: an address gets in only if it has a live invitation or an
existing account. Two ways in, either or both:

* **Google** — needs an OAuth client.
* **A one-time code by email** — needs a mail API key.

> **Gmail and Drive ingestion are not this.** Signing in asks for identity scopes only
> (`openid email profile`). Pulling mail or files is a separate per-tenant consent whose
> credentials are sealed in `app.connection_secret`. Adding Gmail or Drive scopes to the
> login client would hand over a mailbox as a side effect of signing in.

## Two paths

**Path A — full stack in Docker**, browsed at `http://localhost:13000`; good for trying it
or anything production-like. **Path B — local dev loop**, browsed at `http://localhost:5173`
(Vite), with Postgres in compose and the rest run by `bun`; good for iterating on the UI.

The steps are the same either way; only `UNDERCROFT_PUBLIC_URL` and how things start
differ. **`UNDERCROFT_PUBLIC_URL` must be the origin your browser uses**, because Google's
`redirect_uri` is built from it.

## The steps

1. **Make the session secret** (`openssl rand -base64 32`). It signs session cookies;
   changing it later ends every signed-in session at once — which is also how you evict
   everybody in a hurry.
2. **Create the Google OAuth client** — Web application type, one authorized redirect URI
   per origin. The callback path is Better Auth's and is not negotiable. Leave scopes at the
   default and **add nothing else**.
3. **Get a mail API key** (optional). Skipping it means invitation emails will not send
   either, so you have to tell people to sign in yourself — the page tells you when that
   happens.
4. **Write the environment file** from `.env.example`. It is gitignored; do not commit it.
5. **Start Postgres and apply the schema** with `bun run migrate`. Check `060_auth.sql` is
   in the applied or skipped list; re-running prints `already up to date`. On the server you
   never run this by hand — the `db-migrate` compose service applies it on every deploy.
6. **Start the control plane.** Check the boot log says `sign_in_configured` with its
   methods. If it says `sign_in_unconfigured` it names exactly which values are missing —
   the process deliberately starts with no way in rather than offering a button that fails
   on click.
7. **Bootstrap the first admin** with `bun run invite`, using the real address on the
   account you will click through with. `--create-tenant` is opt-in so a typo cannot invent
   a customer. This writes an ordinary invitation and does **not** bypass the gate.
8. **Sign in** — with Google, or by requesting a six-digit code. Verify you land on the
   customers list with the tenant in it and the address in the running head; the invitation
   row should now have `accepted_at` set.
9. **Invite everyone else from the People division — no more SQL.** `viewer` can look;
   `member` can look and trigger a sync; `admin` can do all of it plus connect accounts and
   invite people.

The invitation email is written in Vietnamese unless `--lang en` is passed — see
[[ADR 0012 Vietnamese First, i18next in Browser and Server]]. There is no browser to
negotiate with here, and `--lang` refuses anything but `vi` or `en` rather than quietly
falling back.

## When it does not work

| What you see                             | What it means                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `redirect_uri_mismatch` from Google      | `UNDERCROFT_PUBLIC_URL` does not match a registered URI exactly — `http` vs `https` and the port both count |
| Boot log says `sign_in_unconfigured`     | A required value is unset; it names which                                                                   |
| `Database schema mismatch` / 500 on auth | Migrations not applied                                                                                      |
| "That address has not been invited"      | No live invitation for that exact address — check for a typo or a different case                            |
| No code ever arrives                     | Either mail is not configured or the address is not invited; the server will not say which, on purpose      |
| Signed in, but no customers listed       | A session but no membership — the invitation may have been for another tenant                               |
| `permission denied for table auth_user`  | The auth tables exist without grants; `060_auth.sql` carries its own                                        |
| Sign-in worked, then a blank page        | Stale bundle — hard-reload or rebuild the UI                                                                |

Two by-design behaviours that look like bugs:

* **Asking for a code for an uninvited address returns success and sends nothing.** Saying
  "not invited" would turn the form into a way to test which addresses have access.
* **Signing out leaves a cookie in the browser.** It resolves to no session and is
  overwritten at the next sign-in. The session row is deleted server-side, which is what
  actually matters.
