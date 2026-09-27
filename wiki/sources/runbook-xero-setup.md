---
title: Runbook Xero Setup
type: source
date: 2026-09-27
tags: []
source: docs/runbook/xero-setup.md
source_path: docs/runbook/xero-setup.md
source_hash: 0ad587416202c35a920a9964a4877fec9438daafa07c95a6c5dda2f4f373df98
ingested: 2026-09-27
---

# Runbook Xero Setup

How to stand up per-tenant Xero ingestion. Xero differs from Google in three ways the platform handles: it rotates the refresh token on every refresh (the worker writes the new pair back under a row lock and refuses a refresh that returns none), one consent can see several organisations (the administrator chooses one after consent; its id is sent as the `xero-tenant-id` header and a run without one is refused), and the grant lapses sixty days after its last use (the platform warns admins a week ahead).

The surface is gated on `UNDERCROFT_XERO_CLIENT_ID`, `UNDERCROFT_XERO_CLIENT_SECRET` and `UNDERCROFT_PUBLIC_URL`, an empty value counting as unset; with any unset, Connect Xero still shows and only pressing it says the deployment is not set up.

Setup: create a Web app at developer.xero.com with `<UNDERCROFT_PUBLIC_URL>/oauth/xero/callback` as its redirect URI (production `https://undercroft.lowbit.link/oauth/xero/callback`, local `http://localhost:13000/oauth/xero/callback`; one app may register both), then set the client id and secret on both the control plane (which runs the consent) and the worker (which refreshes and revokes). The consent scopes in `oauthProviders.ts` must match `specs/connectors/xero.yaml`, which `oauthProviders.test.ts` pins. They are Xero's granular scopes (`offline_access`, `accounting.invoices.read`, `accounting.payments.read`, `accounting.contacts.read`): Xero grants the broad `accounting.transactions` to no app created on or after 2 March 2026 and to none after September 2027. `preflight` asserts the panel's compose source and command, not its environment. The page walks the connect flow step by step with what to verify at each: a `403` on every entity is a scope problem, and a `401` naming the organisation is the wrong organisation or a lapsed grant. It ends with a table of failure symptoms and fixes, where a callback returning `reason=not-configured` means `UNDERCROFT_WORKER_URL` or `UNDERCROFT_TRIGGER_TOKEN` is missing on the control plane.
