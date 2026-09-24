---
title: Runbook Sign-In Setup
type: source
date: 2026-09-24
tags: []
source: docs/runbook/sign-in-setup.md
source_path: docs/runbook/sign-in-setup.md
source_hash: b0d923082db470466b9a6bb4c04f7b792eea9dcb68e093b826ccfe52d5c70b66
ingested: 2026-09-24
---

# Runbook Sign-In Setup

A nine-step walkthrough for standing sign-in up from nothing, with a way to check each step actually worked. Sign-in is **invite-only** ([[ADR 0010 Invite-Only Sign-In with Better Auth]]): an address gets in only if it has a live invitation or an existing account. The two ways in are **not symmetric** -- the emailed one-time code needs `UNDERCROFT_EMAIL_API_KEY` and `UNDERCROFT_EMAIL_FROM` and is **required**, because Better Auth is assembled only when its whole environment is present, so with the mail settings absent the control plane comes up with no `/api/auth/*` route at all and the Google button included; Google needs an OAuth client and is added on top. This is not Gmail or Drive ingestion: signing in asks for `openid email profile` only, while a mailbox is a separate per-tenant consent through a **separate Google client** ([[Runbook Google Ingestion Setup]]).

Two paths, differing only in `UNDERCROFT_PUBLIC_URL` and how things start: Path A runs everything in compose (`task dev:up-all`, browse `localhost:13000`), Path B runs Postgres/MinIO/Kestra in compose and the three apps natively with hot reload (`task dev:run`, browse `localhost:5173`). `UNDERCROFT_PUBLIC_URL` **must be the origin the browser uses**, because the `redirect_uri` is built from it. Every command is a `task` ([[ADR 0023 Task Is the Mandatory Command Entrypoint]]).

The steps: generate a session secret; create a Google OAuth client of type *Web application* whose authorized redirect URIs carry Better Auth's non-negotiable `/api/auth/callback/google` path, one line per origin, with scopes left at `openid email profile` and **nothing added**; get a mail API key; write `deploy/compose/.env` from `task dev:env`; start Postgres and `task dev:migrate`, checking `060_auth.sql` is in the applied or skipped list (the migrator prints `skip`/`apply` per file, `state` for the restated `repeatable/010_provision_tenant.sql`, the count applied, then the two platform role passwords it set); start the control plane and read the boot log for `sign_in_configured` with its `methods`. If the schema is behind, sign-in does not degrade but **stops** -- Better Auth answers 500 to every `/api/auth/*` request and logs `Database schema mismatch` while still logging `sign_in_configured`, so "configured" in the log does not mean "working".

Once people are in, **People** is where access is kept current. The roles: a `viewer` looks; a `member` also authors questions and dashboards; an `admin` also connects accounts, runs a sync, edits and builds models, browses and queries the raw lake, and invites and manages people. An admin invites an address at a role, withdraws an invitation nobody has accepted, changes the role of someone who already has access, or removes them. The last two are also `undercroft people set-role` and `undercroft people remove-member`. A removal takes effect on the removed person's next request, even while they are signed in, because authority is read from the membership on every request. The one change refused is the one that would leave a customer with no admin: make someone else an admin first. An admin may step down or leave while another admin remains. Every role change and removal lands in `ops.audit_log` as `people.setRole` or `people.remove`, with the actor, the time and the role held before.
