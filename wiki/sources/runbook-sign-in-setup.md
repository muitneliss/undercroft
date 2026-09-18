---
title: Runbook Sign-In Setup
type: source
date: 2026-09-18
tags: []
source: docs/runbook/sign-in-setup.md
source_path: docs/runbook/sign-in-setup.md
source_hash: f17a2a9ded01c39934c24f682078538bbebd5f703a07f5fdcf9dca997beb76e7
ingested: 2026-09-18
---

# Runbook Sign-In Setup

# Runbook Sign-In Setup

A step-by-step for standing up sign-in from nothing, with a way to check each step actually
worked. The decisions behind it are in
[[ADR 0010 Invite-Only Sign-In with Better Auth]]; the production-specific parts are in
[[Runbook Deployment]].

Sign-in is **invite-only**: an address gets in only if it has a live invitation, an existing
account, or is named in `UNDERCROFT_SUPERADMINS`. Two ways in, either or both:

* **Google** — needs an OAuth client.
* **A one-time code by email** — needs a mail API key.

> **Gmail and Drive ingestion are not this.** Signing in asks for identity scopes only
> (`openid email profile`). Pulling mail or files is a separate per-tenant consent, through a
> **separate Google client**, whose credentials are sealed in `app.connection_secret` by the
> worker. Adding Gmail or Drive scopes to the login client would hand over a mailbox as a side
> effect of signing in. Setting that up is [[Runbook Google Ingestion Setup]].

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
7. **Bootstrap the first admin** — two ways, see below.
8. **Sign in** — with Google, or by requesting a six-digit code.
9. **Invite everyone else from the People division — no more SQL.** `viewer` can look;
   `member` can look and trigger a sync; `admin` can do all of it plus connect accounts and
   invite people.

## Bootstrapping the first admin

**The way that needs no shell: `UNDERCROFT_SUPERADMINS`.** A comma-separated list of
addresses that sign in with no invitation and administer every customer. On the server, set
it in Dokploy's environment and redeploy. The boot log counts them
(`superadmins_configured`), never prints them; `superadmins_none` means the variable did not
reach the process, and `superadmins_rejected` prints back entries it would not read —
almost always a semicolon or a space where a comma belongs.

Name more than one: a single address is a single point of lockout. Those addresses then
create the first customer from the **Add a customer** form on the Customers page, which only
a superadmin sees, and invite everyone else from People.

The variable **is the authority, not a seed** — remove an address and redeploy and it is
withdrawn at the next request, which is also the recovery path if every tenant admin leaves.
It grants authority, never identity: Google or a one-time code still has to prove the
address. See [[ADR 0013 Superadmins Named in the Environment]].

**The way that needs no deploy: `bun run invite`.** Still the right tool for an ordinary
invitation to a single customer. `--create-tenant` is opt-in so a typo cannot invent one.
It writes an ordinary invitation and does **not** bypass the gate. The email is written in
Vietnamese unless `--lang en` is passed — see
[[ADR 0012 Vietnamese First, i18next in Browser and Server]]; there is no browser to
negotiate with here, and `--lang` refuses anything but `vi` or `en` rather than quietly
falling back.

## When it does not work

| What you see                             | What it means                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `redirect_uri_mismatch` from Google      | `UNDERCROFT_PUBLIC_URL` does not match a registered URI exactly — `http` vs `https` and the port both count |
| Boot log says `sign_in_unconfigured`     | A required value is unset; it names which                                                                   |
| Boot log says `superadmins_none`         | `UNDERCROFT_SUPERADMINS` did not reach the process                                                          |
| Boot log says `superadmins_rejected`     | An entry was not an address — usually the wrong separator                                                   |
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
