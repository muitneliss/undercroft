---
title: Runbook Xero Setup
type: source
date: 2026-09-19
tags: []
source: docs/runbook/xero-setup.md
source_path: docs/runbook/xero-setup.md
source_hash: 38127819e71efb2c8b57e87e4f01c4609c9a779b1b0a11a99c8ddca9ba7048c4
ingested: 2026-09-19
---

# Runbook Xero Setup

How to stand up per-tenant Xero ingestion. Xero differs from Google in three ways the platform handles: it rotates the refresh token on every refresh (the worker writes the new pair back under a row lock and refuses a refresh that returns none), one consent can see several organisations (the administrator chooses one after consent; its id is sent as the `xero-tenant-id` header and a run without one is refused), and the grant lapses sixty days after its last use (the platform warns admins a week ahead).

Setup: create a Web app at developer.xero.com with `<UNDERCROFT_PUBLIC_URL>/oauth/xero/callback` as its only redirect URI, then set `UNDERCROFT_XERO_CLIENT_ID` and `UNDERCROFT_XERO_CLIENT_SECRET` on both the control plane (which runs the consent) and the worker (which refreshes and revokes). The consent scopes in `oauthProviders.ts` must match `specs/connectors/xero.yaml`. The page walks the connect flow step by step with what to verify at each, and ends with a table of failure symptoms and fixes.
