---
title: Runbook Xero Setup
type: source
date: 2026-09-28
tags: []
source: docs/runbook/xero-setup.md
source_path: docs/runbook/xero-setup.md
source_hash: e5171b5870098d7a9b2afcb9c41b84332f840c122e5ca8011f611e91a1afaf5e
ingested: 2026-09-28
---

# Runbook Xero Setup

# Runbook Xero Setup

How to stand up per-tenant Xero ingestion. Xero differs from Google in three ways the platform handles: it rotates the refresh token on every refresh (the worker writes the new pair back under a row lock and refuses a refresh that returns none), one consent can see several organisations (the administrator chooses one after consent; its id is sent as the `xero-tenant-id` header and a run without one is refused), and the grant lapses sixty days after its last use (the platform warns admins a week ahead).

The surface is gated on `UNDERCROFT_XERO_CLIENT_ID`, `UNDERCROFT_XERO_CLIENT_SECRET` and `UNDERCROFT_PUBLIC_URL`, an empty value counting as unset; with any unset, Connect Xero still shows and only pressing it says the deployment is not set up.

Setup: create a Web app at developer.xero.com with `<UNDERCROFT_PUBLIC_URL>/oauth/xero/callback` as its redirect URI (production `https://undercroft.lowbit.link/oauth/xero/callback`, local `http://localhost:13000/oauth/xero/callback`; one app may register both), then set the client id and secret on both the control plane (which runs the consent) and the worker (which refreshes and revokes). `preflight` asserts the panel's compose source and command, not its environment.

Scopes: the consent scopes in `oauthProviders.ts` must match `specs/connectors/xero.yaml`, and `oauthProviders.test.ts` fails when they differ or when an entity's `readScope` is not the scope Xero reads its list under. Every entity names its `readScope`, and the spec schema refuses one that does not or that names a scope the consent lacks. They are Xero's granular scopes: `offline_access` (makes Xero issue a refresh token); `accounting.invoices.read` (invoices, credit notes, quotes, purchase orders, repeating invoices, linked transactions); `accounting.payments.read` (payments, overpayments, prepayments, batch payments); `accounting.contacts.read` (contacts, contact groups); `accounting.settings.read` (items, chart of accounts, tracking categories and their options, tax rates, currencies). Xero grants the broad `accounting.transactions` to no app created on or after 2 March 2026 and to none after September 2027. A connection whose recorded grant lacks a scope the consent asks for reads reconnect on its card; its runs still read every list the grant reaches, never request the rest, and name each in the Journal with the scope a reconnect would add, and a run left with no readable list fails naming the scope. Adding an entity that needs a new scope means adding the scope in both places and the test's path-to-scope table; existing connections read the new list after they reconnect. See [[ADR 0069 Xero Reads Every List Its Granular Scopes Reach]] and [[ADR 0071 A List Its Grant Cannot Read Is Named Not Failed]].

The page walks the connect flow step by step with what to verify at each: an organisation with no quotes, purchase orders or batch payments reads `0` for those lists, which is not a failure, while an empty first read of contacts, invoices, payments or credit notes is; a `403` on every entity is a scope problem, and a `401` naming the organisation is the wrong organisation or a lapsed grant. It ends with a table of failure symptoms and fixes: a callback returning `reason=not-configured` means `UNDERCROFT_WORKER_URL` or `UNDERCROFT_TRIGGER_TOKEN` is missing on the control plane, and a list the Journal says is "not granted" means the grant predates a scope the consent now asks for, fixed by reconnecting.
