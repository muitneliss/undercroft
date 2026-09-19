---
title: 'ADR 0020: BI is first-party, Metabase leaves the stack'
type: source
date: 2026-09-19
tags: []
source: docs/adr/0020-bi-is-first-party-metabase-leaves-the-stack.md
source_path: docs/adr/0020-bi-is-first-party-metabase-leaves-the-stack.md
source_hash: 88f20383b22cfa4556a750199eff7323456d5d9a32e439f35cd5266a17edfcee
ingested: 2026-09-19
---

# ADR 0020: BI is first-party, Metabase leaves the stack

The Reports division of the control plane is the BI, and Metabase with its own Postgres leaves both compose files, along with the `undercroft-bi.lowbit.link` domain and `UNDERCROFT_METABASE_PG_PASSWORD`. A question is a visual definition the server compiles to SQL or SQL written in the editor, drawn by one of sixteen Chart.js chart types; a dashboard puts saved questions on a twelve-column grid under shared filters whose values live in the URL. Every question runs through the worker as the tenant's own read-only login (`undercroft_bi_<slug>`) in a read-only transaction with a statement timeout, extending [[ADR 0018: per-tenant roles and row-level security]] from writes to reads: a compromised control plane holds no tenant's database credential. Members and admins author; viewers read. The platform `undercroft_bi` role stays for an operator's external SQL client.

Why: the operator holds many customers' case books and switches mid-call, and two applications with two navigations and two ideas of a dashboard is what that surface cannot afford. Verified against Metabase's documentation (2026-09), the open-source and Starter editions embed only guest views (no exploring), while the query builder, drill-through, full-app embedding and the React SDK need Pro or Enterprise with JWT SSO and an account per viewer, whose permissions would be a second owner of who may see what.

Rejected: Metabase OSS as guest embeds (viewers cannot ask, members author in a second navigation); Metabase Pro with JWT SSO (a licence, a seat per viewer, permissions mirrored by hand); keeping Metabase for the operator alone (two definitions of a dashboard).

Costs: a bounded chart set to maintain (what it cannot draw, the table prints); one query per tile per filter change with a batched answer as a later addition; no drill-through (a tile links to its question); series colour follows rank, not entity. Money is never a float on a chart — one `Big` conversion under one recorded suppression positions a bar, and every readable figure is printed from the original digits. Supersedes the stack listing in [[ADR 0008 Deploy on Release from CI]].
