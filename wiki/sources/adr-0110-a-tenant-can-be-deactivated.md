---
title: ADR 0110 A Tenant Can Be Deactivated
type: source
date: 2026-10-05
tags: []
source: docs/adr/0110-a-tenant-can-be-deactivated.md
source_path: docs/adr/0110-a-tenant-can-be-deactivated.md
source_hash: ec1d28df857781810faa4283fe96bf915c5c1f8043dd9511ceca01bee884e174
ingested: 2026-10-05
---

# ADR 0110 A Tenant Can Be Deactivated

A whole tenant (customer) can now be deactivated and reactivated by its own admin, or by a superadmin acting as its admin under [[ADR 0013 Superadmins Named in the Environment]]. While it is deactivated every member loses access to it and nothing is started for it; nothing is deleted, because the raw lake is the durable layer ([[ADR 0001 Raw Lake Is the Only Durable Layer]]), and reactivating restores exactly what was there.

State: one nullable column, `ops.tenant.deactivated_at` (`480_tenant_deactivation.sql`), `NULL` while in use and the moment of deactivation otherwise; "active" is derived, never stored. Each transition is an `ops.audit_log` row, `tenants.deactivate` or `tenants.reactivate`, with the actor. The procedures are `tenants.deactivate` and `tenants.reactivate`, both `requireRole("admin")`; a transition to the state the tenant is already in is refused PRECONDITION\_FAILED (`TENANT_DEACTIVATED` or `TENANT_ACTIVE`), never a quiet success, and the conditional `UPDATE` keeps the first of two concurrent presses. Deactivate is classed `write`, not `destructive`, because `reactivate` undoes it and the CLI words `destructive` as "deletes data and cannot be undone".

Enforcement in the router is one place: `tenantProcedure` in `handlers/trpc.ts` is `tenantStatusProcedure` (authority and state, via `accessIn`, formerly `authorityIn`) plus a middleware refusing a deactivated tenant with PRECONDITION\_FAILED, worded, with facts `reason: TENANT_DEACTIVATED`, the tenant id and `deactivatedAt`. It runs after the 404-not-403 boundary, so a non-member still learns nothing. Every door that calls the router inherits it -- the browser, the CLI ([[ADR 0044: An agent reaches Undercroft as a caller]]), `/mcp` ([[ADR 0060: An agent reaches Undercroft over MCP, with a credential a person holds]]) and the assistant ([[ADR 0029: The assistant is an interleaf, and it acts only through the router]]). Only `tenants.get` (so a page can show the state) and `tenants.reactivate` (`requireRole("admin", tenantStatusProcedure)`) opt out, by their builder rather than a path list; a test sweeps every tenant-scoped procedure in the manifest to pin it. `tenants.list` and `tenants.get` carry `deactivatedAt`, and a deactivated customer stays in its members' list, marked.

Outside the router: the run ledger's `openRun` and `claimExternalRun` insert only for a tenant that is not deactivated, so every scheduled sync, extract, build, classification, manual trigger and pushed batch is refused in one statement; the worker raises `TenantDeactivated` (HTTP 409 `tenant_deactivated`) through `openRunOrRefuse` and the ledger's `claimExternal`. The three due lists (`/v1/runs/due`, `extract-due`, `semantic-due`) put a deactivated tenant's pairs under `skipped` with `reason: tenant_deactivated` and log `due_skipped`; the Kestra flows loop over `due` only. The alert tick claims notices about a deactivated tenant but sends them nowhere, logging `alert_withheld` and counting `withheld`. The OAuth callback refuses a consent started before deactivation (`tenant-deactivated`), and the assistant's chat and history answer a worded 409, since both establish authority through `tenants.get`. Tenant Postgres logins are unchanged: they hold no stored password and are leased per session by the worker ([[ADR 0087 A Tenant Login Is Leased Not Rotated Per Session]]), so no external BI tool holds one.

UI: Deactivate is a two-step fold at the foot of Sources beside the display name; the book waits for `tenants.get` and, for a deactivated customer, shows a notice in place of the division -- Reactivate for an admin, who-can for anyone else -- and hides the assistant.

Rejected: per-person or per-membership deactivation, deleting the tenant, superadmin-only, a stored `status` enum, enforcing per procedure or by a path allow-list, NOT\_FOUND for a deactivated tenant, and dropping deactivated pairs from the due lists without a word.
