---
title: Runbook Xero Setup
type: source
date: 2026-09-24
tags: []
source: docs/runbook/xero-setup.md
source_path: docs/runbook/xero-setup.md
source_hash: 2d382ff3d9f19ca858f9eb8513705cca7c9ae114bd07d7541e4579819cee75fc
ingested: 2026-09-24
---

# Runbook Xero Setup

How to stand up per-tenant Xero ingestion. Xero differs from Google in three ways the platform handles: it rotates the refresh token on every refresh (the worker writes the new pair back under a row lock and refuses a refresh that returns none), one consent can see several organisations (the administrator chooses one after consent; its id is sent as the `xero-tenant-id` header and a run without one is refused), and the grant lapses sixty days after its last use (the platform warns admins a week ahead).

Setup: create a Web app at developer.xero.com with `<UNDERCROFT_PUBLIC_URL>/oauth/xero/callback` as its only redirect URI, then set `UNDERCROFT_XERO_CLIENT_ID` and `UNDERCROFT_XERO_CLIENT_SECRET` on both the control plane (which runs the consent) and the worker (which refreshes and revokes). The consent scopes in `oauthProviders.ts` must match `specs/connectors/xero.yaml`. `preflight` asserts the panel's compose source and command, not its environment, so a missing client shows up as Connect Xero being refused as not set up. The page walks the connect flow step by step with what to verify at each: a `403` on every entity is a scope problem, and a `401` naming the organisation is the wrong organisation or a lapsed grant. It ends with a table of failure symptoms and fixes, where a callback returning `reason=not-configured` means `UNDERCROFT_WORKER_URL` or `UNDERCROFT_TRIGGER_TOKEN` is missing on the control plane.
